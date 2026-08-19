import { Module } from '@nestjs/common';
import { BridgesController } from './bridges.controller';
import { BridgesService } from './bridges.service';

@Module({
  controllers: [BridgesController],
  providers: [BridgesService],
  exports: [BridgesService],
})
export class BridgesModule {}
