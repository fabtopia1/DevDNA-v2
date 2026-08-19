import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@Controller('v1/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Headline counters, trends and recent activity' })
  summary(@CurrentUser() user: AuthenticatedUser, @Query('days') days = '30') {
    const window = Math.min(365, Math.max(1, Number.parseInt(days, 10) || 30));
    return this.dashboard.summary(user.organizationId, window);
  }
}
