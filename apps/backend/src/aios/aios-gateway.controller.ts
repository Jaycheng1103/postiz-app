import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { AiosGatewayService } from './aios-gateway.service';
import { AiosServiceTokenGuard } from './aios-service-token.guard';

@Controller('/aios/v1')
@UseGuards(AiosServiceTokenGuard)
export class AiosGatewayController {
  constructor(private readonly gateway: AiosGatewayService) {}

  @Post('/organizations')
  provisionOrganization(
    @Headers('x-aios-account-id') aiosAccountId: string,
    @Body() body: { aiosAccountId: string; displayName: string }
  ) {
    assertAccountMatch(aiosAccountId, body.aiosAccountId);
    return this.gateway.provisionOrganization(
      aiosAccountId,
      body.displayName
    );
  }

  @Post('/organizations/:organizationId/connect-intents')
  createConnectIntent(
    @Headers('x-aios-account-id') aiosAccountId: string,
    @Param('organizationId') organizationId: string,
    @Body()
    body: {
      aiosAccountId: string;
      provider: 'youtube';
      aiosConnectionIntentId: string;
      browserReturnUrl: string;
      completionWebhookUrl: string;
    }
  ) {
    assertAccountMatch(aiosAccountId, body.aiosAccountId);
    return this.gateway.createConnectIntent({
      ...body,
      aiosAccountId,
      organizationId,
    });
  }

  @Get('/organizations/:organizationId/integrations')
  listIntegrations(
    @Headers('x-aios-account-id') aiosAccountId: string,
    @Param('organizationId') organizationId: string
  ) {
    return this.gateway.listIntegrations(aiosAccountId, organizationId);
  }

  @Get(
    '/organizations/:organizationId/integrations/:integrationId/analytics'
  )
  getAnalytics(
    @Headers('x-aios-account-id') aiosAccountId: string,
    @Param('organizationId') organizationId: string,
    @Param('integrationId') integrationId: string,
    @Query('provider') provider: string,
    @Query('period') period: string
  ) {
    return this.gateway.getAnalytics({
      aiosAccountId,
      organizationId,
      integrationId,
      provider,
      period: Number(period),
    });
  }

  @Delete('/organizations/:organizationId/integrations/:integrationId')
  async disconnect(
    @Headers('x-aios-account-id') aiosAccountId: string,
    @Param('organizationId') organizationId: string,
    @Param('integrationId') integrationId: string
  ) {
    await this.gateway.disconnect(
      aiosAccountId,
      organizationId,
      integrationId
    );
  }

  @Delete('/organizations/:organizationId')
  async deleteOrganization(
    @Headers('x-aios-account-id') aiosAccountId: string,
    @Param('organizationId') organizationId: string
  ) {
    await this.gateway.deleteOrganization(aiosAccountId, organizationId);
  }
}

@Controller('/aios/connect')
export class AiosConnectController {
  constructor(private readonly gateway: AiosGatewayService) {}

  @Get('/:state')
  async redirectToProvider(
    @Param('state') state: string,
    @Res() response: Response
  ) {
    response.redirect(await this.gateway.consumeAuthorizationRedirect(state));
  }
}

function assertAccountMatch(headerAccountId: string, bodyAccountId: string) {
  if (!headerAccountId || headerAccountId !== bodyAccountId) {
    throw new Error('AIOS account identity mismatch');
  }
}
