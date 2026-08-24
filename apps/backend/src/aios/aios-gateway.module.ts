import { Module } from '@nestjs/common';

import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';

import {
  AiosConnectController,
  AiosGatewayController,
} from './aios-gateway.controller';
import { AiosGatewayService } from './aios-gateway.service';
import { AiosServiceTokenGuard } from './aios-service-token.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [AiosGatewayController, AiosConnectController],
  providers: [AiosGatewayService, AiosServiceTokenGuard],
  exports: [AiosGatewayService],
})
export class AiosGatewayModule {}
