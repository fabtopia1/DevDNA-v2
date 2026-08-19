import { Controller, Get, Header, Param, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, Public, Roles, type AuthenticatedUser } from '../../common/decorators';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('v1')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Roles('TECHNICIAN')
  @Post('inspections/:id/report')
  @ApiOperation({ summary: 'Generate a PDF verification report for an inspection' })
  generate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.reports.generate(user.organizationId, id, user.userId);
  }

  @Get('reports/:id/download')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Download a generated report' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.reports.download(user.organizationId, id);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Public()
  @Get('verify/:publicId')
  @ApiOperation({ summary: 'Public verification of a report by its QR code id' })
  verify(@Param('publicId') publicId: string) {
    return this.reports.verifyPublic(publicId.toUpperCase());
  }
}
