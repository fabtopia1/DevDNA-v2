import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Roles, type AuthenticatedUser } from '../../common/decorators';
import { BridgesService } from './bridges.service';

class PairBridgeDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name!: string;

  @IsOptional() @IsString() @MaxLength(120)
  workstation?: string;
}

@ApiTags('bridges')
@Controller('v1/bridges')
export class BridgesController {
  constructor(private readonly bridges: BridgesService) {}

  @Get()
  @ApiOperation({ summary: 'List paired workstations' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.bridges.list(user.organizationId);
  }

  @Roles('ADMIN')
  @Post()
  @ApiOperation({ summary: 'Pair a workstation and return its one-time credentials' })
  pair(@CurrentUser() user: AuthenticatedUser, @Body() dto: PairBridgeDto) {
    return this.bridges.pair(user.organizationId, user.userId, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @ApiOperation({ summary: 'Revoke a workstation' })
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bridges.revoke(user.organizationId, user.userId, id);
  }
}
