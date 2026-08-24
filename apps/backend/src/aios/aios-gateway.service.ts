import { HttpException, Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import dayjs from 'dayjs';

import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

const AIOS_YOUTUBE_SCOPES = ['youtube.readonly', 'yt-analytics.readonly'];
const AIOS_INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_insights',
];
const YOUTUBE_METRIC_KEYS: Record<string, string> = {
  Views: 'views',
  'Estimated Minutes Watched': 'estimatedMinutesWatched',
  'Average View Duration': 'averageViewDuration',
  'Average View Percentage': 'averageViewPercentage',
  'Subscribers Gained': 'subscribersGained',
  'Subscribers Lost': 'subscribersLost',
  Likes: 'likes',
};
const INSTAGRAM_METRIC_KEYS: Record<string, string> = {
  'Follower Count': 'followerCount',
  Reach: 'reach',
  Views: 'views',
  Likes: 'likes',
  Comments: 'comments',
  Shares: 'shares',
  Saves: 'saves',
  Replies: 'replies',
};

type AiosSocialProvider = 'youtube' | 'instagram';

const providerIdentifier = (provider: AiosSocialProvider) =>
  provider === 'youtube' ? 'youtube' : 'instagram-standalone';

const aiosProvider = (identifier: string): AiosSocialProvider | null => {
  if (identifier === 'youtube') return 'youtube';
  if (identifier === 'instagram-standalone') return 'instagram';
  return null;
};

type AiosAnalyticsMetric = {
  sourceMetricKey: string;
  periodStart: string;
  periodEnd: string;
  dimensions: Record<string, never>;
  granularity: 'day' | 'interval';
  intervalDays?: 7 | 30 | 90;
  value: number | null;
  status: 'available' | 'no_data';
};

@Injectable()
export class AiosGatewayService {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly integrations: IntegrationService,
    private readonly integrationManager: IntegrationManager
  ) {}

  async provisionOrganization(aiosAccountId: string, displayName: string) {
    const organization = await this.organizations.createAiosOrganization(
      aiosAccountId,
      displayName
    );

    return { organizationId: organization.id };
  }

  async createConnectIntent(input: {
    aiosAccountId: string;
    organizationId: string;
    provider: AiosSocialProvider;
    aiosConnectionIntentId: string;
    browserReturnUrl: string;
    completionWebhookUrl: string;
  }) {
    await this.assertOrganization(input.aiosAccountId, input.organizationId);
    const browserReturnUrl = this.assertAiosUrl(
      input.browserReturnUrl,
      input.provider === 'youtube'
        ? ['/home/youtube', '/home/flywheel']
        : ['/home/instagram', '/home/flywheel']
    );
    const completionWebhookUrl = this.assertAiosUrl(
      input.completionWebhookUrl,
      [`/api/aios/integrations/${input.provider}/callback`]
    );
    const provider = this.integrationManager.getSocialIntegration(
      providerIdentifier(input.provider)
    );
    const { codeVerifier, state, url } = await provider.generateAuthUrl();
    const ttlSeconds = 3600;

    await Promise.all([
      ioRedis.set(`organization:${state}`, input.organizationId, 'EX', ttlSeconds),
      ioRedis.set(`login:${state}`, codeVerifier, 'EX', ttlSeconds),
      ioRedis.set(`redirect:${state}`, browserReturnUrl, 'EX', ttlSeconds),
      ioRedis.set(`webhookUrl:${state}`, completionWebhookUrl, 'EX', ttlSeconds),
      ioRedis.set(`aiosAuthUrl:${state}`, url, 'EX', ttlSeconds),
      ioRedis.set(
        `aiosIntent:${state}`,
        JSON.stringify({
          intentId: input.aiosConnectionIntentId,
          aiosAccountId: input.aiosAccountId,
          organizationId: input.organizationId,
          provider: input.provider,
        }),
        'EX',
        ttlSeconds
      ),
    ]);

    const publicOrigin = new URL(
      process.env.AIOS_GATEWAY_PUBLIC_ORIGIN || process.env.MAIN_URL || ''
    ).origin;

    return {
      authorizationUrl: `${publicOrigin}/aios/connect/${encodeURIComponent(state)}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  async consumeAuthorizationRedirect(state: string) {
    const key = `aiosAuthUrl:${state}`;
    const url = await ioRedis.get(key);
    if (!url) throw new HttpException('Invalid or expired AIOS OAuth state', 404);
    await ioRedis.del(key);
    return url;
  }

  async notifyOauthCompletion(
    state: string,
    integrationId: string
  ): Promise<'not-aios' | 'deferred' | 'delivered'> {
    const serializedIntent = await ioRedis.get(`aiosIntent:${state}`);
    if (!serializedIntent) return 'not-aios';

    const intent = JSON.parse(serializedIntent) as {
      intentId: string;
      aiosAccountId: string;
      organizationId: string;
      provider: AiosSocialProvider;
    };
    const integration = await this.integrations.getIntegrationById(
      intent.organizationId,
      integrationId
    );
    if (
      !integration ||
      integration.providerIdentifier !== providerIdentifier(intent.provider)
    ) {
      throw new HttpException('AIOS OAuth integration mismatch', 409);
    }
    if (integration.inBetweenSteps) return 'deferred';

    const webhookUrl = await ioRedis.get(`webhookUrl:${state}`);
    const secret = process.env.AIOS_CALLBACK_HMAC_SECRET;
    if (!webhookUrl || !secret) {
      throw new HttpException('AIOS OAuth callback is not configured', 503);
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID();
    const body = JSON.stringify({
      schemaVersion: 1,
      intentId: intent.intentId,
      aiosAccountId: intent.aiosAccountId,
      organizationId: intent.organizationId,
      provider: intent.provider,
      integrationId,
      occurredAt: new Date().toISOString(),
    });
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${nonce}.${body}`)
      .digest('hex');
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-aios-timestamp': timestamp,
        'x-aios-nonce': nonce,
        'x-aios-signature': signature,
      },
      body,
      // @ts-ignore — undici option, not in lib.dom fetch types
      dispatcher: getSsrfSafeDispatcher(),
    });
    if (!response.ok) {
      throw new HttpException('AIOS OAuth callback delivery failed', 502);
    }

    await ioRedis.del(`webhookUrl:${state}`, `aiosIntent:${state}`);
    return 'delivered';
  }

  async listIntegrations(aiosAccountId: string, organizationId: string) {
    await this.assertOrganization(aiosAccountId, organizationId);

    return (await this.integrations.getIntegrationsList(organizationId))
      .filter(
        (integration) =>
          aiosProvider(integration.providerIdentifier) !== null &&
          !integration.inBetweenSteps
      )
      .map((integration) => {
        const provider = aiosProvider(integration.providerIdentifier)!;
        return {
          id: integration.id,
          provider,
          externalAccountId: integration.internalId,
          name: integration.name,
          ...(integration.picture ? { pictureUrl: integration.picture } : {}),
          disabled: integration.disabled,
          scopes:
            provider === 'youtube'
              ? AIOS_YOUTUBE_SCOPES
              : AIOS_INSTAGRAM_SCOPES,
        };
      });
  }

  async getAnalytics(input: {
    aiosAccountId: string;
    organizationId: string;
    integrationId: string;
    provider: string;
    period: number;
  }) {
    const organization = await this.assertOrganization(
      input.aiosAccountId,
      input.organizationId
    );
    if (
      !['youtube', 'instagram'].includes(input.provider) ||
      ![7, 30, 90].includes(input.period)
    ) {
      throw new HttpException('Unsupported analytics request', 400);
    }

    const provider = input.provider as AiosSocialProvider;
    const metricKeys =
      provider === 'youtube' ? YOUTUBE_METRIC_KEYS : INSTAGRAM_METRIC_KEYS;
    const integration = await this.integrations.getIntegrationById(
      organization.id,
      input.integrationId
    );
    if (
      !integration ||
      integration.providerIdentifier !== providerIdentifier(provider)
    ) {
      throw new HttpException('AIOS analytics integration mismatch', 409);
    }

    const analytics = await this.integrations.checkAnalytics(
      organization,
      input.integrationId,
      String(input.period)
    );
    const now = new Date();
    const periodEnd = now.toISOString();
    const periodStart = new Date(
      now.getTime() - input.period * 24 * 60 * 60 * 1000
    ).toISOString();
    const metrics = analytics.flatMap<AiosAnalyticsMetric>((series) => {
      const sourceMetricKey = metricKeys[series.label];
      if (!sourceMetricKey) return [];
      const rows = series.data ?? [];

      if (!rows.length) {
        return [
          {
            sourceMetricKey,
            periodStart,
            periodEnd,
            dimensions: {},
            granularity: 'interval' as const,
            intervalDays: input.period as 7 | 30 | 90,
            value: null,
            status: 'no_data' as const,
          },
        ];
      }

      return rows.map((row) => {
        const start = dayjs.utc(row.date).startOf('day');
        const value = Number(row.total);

        return {
          sourceMetricKey,
          periodStart: start.toISOString(),
          periodEnd: start.add(1, 'day').toISOString(),
          dimensions: {},
          granularity: 'day' as const,
          value: Number.isFinite(value) ? value : null,
          status: Number.isFinite(value)
            ? ('available' as const)
            : ('no_data' as const),
        };
      });
    });

    return {
      schemaVersion: 1 as const,
      requestId: randomUUID(),
      adapterKey:
        provider === 'youtube'
          ? ('youtube' as const)
          : ('instagram-standalone' as const),
      provider,
      dataThrough: periodEnd,
      metrics,
    };
  }

  async disconnect(
    aiosAccountId: string,
    organizationId: string,
    integrationId: string
  ) {
    await this.assertOrganization(aiosAccountId, organizationId);
    await this.integrations.deleteChannel(organizationId, integrationId);
  }

  async deleteOrganization(aiosAccountId: string, organizationId: string) {
    await this.assertOrganization(aiosAccountId, organizationId);
    for (const integration of await this.integrations.getIntegrationsList(
      organizationId
    )) {
      await this.integrations.deleteChannel(organizationId, integration.id);
    }
    await this.organizations.deleteAiosOrganization(organizationId);
  }

  private async assertOrganization(
    aiosAccountId: string,
    organizationId: string
  ) {
    const organization =
      await this.organizations.getOrgByAiosAccountId(aiosAccountId);
    if (
      !organization ||
      organization.id !== organizationId ||
      organization.deletedAt
    ) {
      throw new HttpException('AIOS organization mapping not found', 404);
    }
    return organization;
  }

  private assertAiosUrl(candidate: string, allowedPaths: string[]) {
    const url = new URL(candidate);
    const origins = (process.env.AIOS_ALLOWED_CALLBACK_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => new URL(origin).origin);

    if (
      !origins.includes(url.origin) ||
      !allowedPaths.includes(url.pathname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new HttpException('AIOS callback URL is not allowlisted', 400);
    }

    return url.toString();
  }
}
