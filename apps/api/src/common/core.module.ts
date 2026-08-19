import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { PrismaService } from './prisma.service';
import { BridgeSignatureGuard } from './guards/bridge-signature.guard';
import { CONFIG_TOKEN, loadConfiguration } from '../config/configuration';

/**
 * Cross-cutting infrastructure every feature module depends on: configuration,
 * database access, audit logging, encryption and the bridge signature guard.
 * Global so feature modules do not each have to re-import it.
 */
@Global()
@Module({
  providers: [
    { provide: CONFIG_TOKEN, useFactory: loadConfiguration },
    PrismaService,
    AuditService,
    CryptoService,
    BridgeSignatureGuard,
  ],
  exports: [CONFIG_TOKEN, PrismaService, AuditService, CryptoService, BridgeSignatureGuard],
})
export class CoreModule {}
