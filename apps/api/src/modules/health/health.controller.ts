import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ENGINE_VERSION, TRUST_ALGORITHM_VERSION } from '@devdna/core';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness and dependency check' })
  async health() {
    let database = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    return {
      ok: database === 'up',
      service: 'devdna-api',
      engineVersion: ENGINE_VERSION,
      trustAlgorithmVersion: TRUST_ALGORITHM_VERSION,
      database,
      timestamp: new Date().toISOString(),
    };
  }
}
