import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';

@ApiTags('devices')
@Controller('v1/devices')
export class DevicesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Devices this organization has inspected' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Query('search') search?: string,
  ) {
    const take = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 25));
    const skip = (Math.max(1, Number.parseInt(page, 10) || 1) - 1) * take;
    const where = {
      organizationId: user.organizationId,
      ...(search
        ? {
            OR: [
              { marketingName: { contains: search, mode: 'insensitive' as const } },
              { productType: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.device.count({ where }),
      this.prisma.device.findMany({
        where,
        orderBy: { lastSeenAt: 'desc' },
        skip,
        take,
        include: {
          inspections: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, trustScore: true, verificationStatus: true, createdAt: true },
          },
        },
      }),
    ]);

    return {
      items: items.map((device) => ({ ...device, latestInspection: device.inspections[0] ?? null, inspections: undefined })),
      total,
      page: Number(page),
      pageSize: take,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Device detail and full inspection history' })
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const device = await this.prisma.device.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        inspections: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: {
            id: true,
            createdAt: true,
            trustScore: true,
            verificationStatus: true,
            batteryScore: true,
            partsScore: true,
            softwareScore: true,
            batteryHealthPercent: true,
            batteryCycleCount: true,
          },
        },
      },
    });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }
}
