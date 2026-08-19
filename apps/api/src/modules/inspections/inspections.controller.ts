import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import type { InspectionReport, RawDeviceSnapshot } from '@devdna/core';
import { BridgeAuth, CurrentUser, Roles, type AuthenticatedUser } from '../../common/decorators';
import { BridgeSignatureGuard, type BridgePrincipal } from '../../common/guards/bridge-signature.guard';
import { InspectionsService } from './inspections.service';

class ListInspectionsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 25;

  @IsOptional() @IsString()
  verdict?: string;

  /** Narrow to inspections where this component was found replaced. */
  @IsOptional() @IsString()
  replacedComponent?: string;

  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsString()
  deviceId?: string;

  @IsOptional() @IsISO8601()
  from?: string;

  @IsOptional() @IsISO8601()
  to?: string;
}

class IngestDto {
  /**
   * The raw capture. Decorated so the global whitelisting ValidationPipe keeps
   * it; its internal shape is validated in the service, which owns the
   * snapshot schema contract.
   */
  @IsObject() @IsNotEmptyObject()
  snapshot!: RawDeviceSnapshot;

  /** The bridge's own scoring. Retained for divergence detection only. */
  @IsOptional() @IsObject()
  result?: InspectionReport;

  @IsOptional() @IsString() @MaxLength(120)
  workstation?: string;

  @IsOptional() @IsString() @MaxLength(40)
  customerId?: string;
}

@ApiTags('inspections')
@Controller('v1/inspections')
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  /**
   * Bridge ingestion. Authenticated by HMAC signature rather than a JWT — the
   * caller is a workstation daemon, not a logged-in human.
   */
  @BridgeAuth()
  @UseGuards(BridgeSignatureGuard)
  @Post('ingest')
  @ApiOperation({ summary: 'Submit a raw device snapshot from a paired bridge' })
  async ingest(@Body() dto: IngestDto, @Req() req: Request) {
    const bridge = (req as Request & { bridge: BridgePrincipal }).bridge;
    return this.inspections.ingest({
      organizationId: bridge.organizationId,
      bridgeId: bridge.bridgeId,
      snapshot: dto.snapshot,
      clientReport: dto.result ?? null,
      workstation: dto.workstation ?? null,
      customerId: dto.customerId ?? null,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List inspections for the current organization' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListInspectionsQuery) {
    return this.inspections.list(user.organizationId, {
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 25,
      ...(query.verdict ? { verdict: query.verdict } : {}),
      ...(query.replacedComponent ? { replacedComponent: query.replacedComponent } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.deviceId ? { deviceId: query.deviceId } : {}),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Inspection conclusions: verdicts, components and findings' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inspections.get(user.organizationId, id);
  }

  /**
   * Evidence is served on its own route, not folded into the inspection.
   * Separating them is the point: a caller can read conclusions without
   * evidence or evidence without conclusions, and the two are never conflated.
   */
  @Get(':id/evidence')
  @ApiOperation({ summary: 'The raw evidence and inferences behind an inspection' })
  evidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('subject') subject?: string,
  ) {
    return this.inspections.evidence(user.organizationId, id, subject ? { subject } : {});
  }

  @Get(':id/audit')
  @ApiOperation({ summary: 'Ordered record of how this inspection was produced' })
  audit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inspections.auditTrail(user.organizationId, id);
  }

  @Roles('TECHNICIAN')
  @Post(':id/rescore')
  @ApiOperation({ summary: 'Re-score stored evidence under the current engine' })
  rescore(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inspections.rescore(user.organizationId, id, user.userId);
  }
}
