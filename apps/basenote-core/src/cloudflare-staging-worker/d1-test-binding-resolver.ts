import { ProfileQueueOwnershipDeniedError } from "./boundaries.js";
import type {
  AuthorizedProfileQueueBinding,
  ProfileQueueOwnershipResolver,
} from "./contracts.js";
import { asProfileQueueActorRef } from "../profile-queue/contracts.js";
import { asBindingId, asCycleKey, asIsoTimestamp, asShipMonth } from "../queue/types.js";
import type { D1DatabasePort } from "../staging-runtime/d1.js";

interface TestBindingRow {
  readonly actor_ref: string;
  readonly binding_id: string;
  readonly cycle_key: string;
  readonly expires_at: string;
  readonly shop_domain: string;
  readonly shopify_customer_id: string;
  readonly ship_month: string;
  readonly status: string;
}

const SELECT_ACTIVE_TEST_BINDING = `
  SELECT actor_ref, binding_id, cycle_key, expires_at, shop_domain,
    shopify_customer_id, ship_month, status
  FROM staging_profile_queue_test_bindings
  WHERE shop_domain = ?
    AND shopify_customer_id = ?
    AND cycle_key = ?
    AND ship_month = ?
    AND status = 'ACTIVE'
    AND expires_at > ?`;

export interface D1StagingTestBindingOwnershipResolverOptions {
  readonly now?: () => Date;
}

/**
 * Authorizes only an exact, manually seeded disposable-store binding. It does
 * not discover subscriptions, select a customer's first contract, call
 * Shopify/Appstle, or accept a browser-provided binding ID.
 */
export class D1StagingTestBindingOwnershipResolver implements ProfileQueueOwnershipResolver {
  private readonly now: () => Date;

  constructor(
    private readonly database: D1DatabasePort,
    options: D1StagingTestBindingOwnershipResolverOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async resolve(input: {
    readonly cycleKey: string;
    readonly identity: { readonly shopDomain: string; readonly shopifyCustomerId: string };
    readonly shipMonth: string;
  }): Promise<AuthorizedProfileQueueBinding> {
    let cycleKey: string;
    let shipMonth: string;
    try {
      cycleKey = asCycleKey(input.cycleKey);
      shipMonth = asShipMonth(input.shipMonth);
    } catch {
      throw denied();
    }
    const now = this.now().toISOString();
    const row = await this.database
      .prepare(SELECT_ACTIVE_TEST_BINDING)
      .bind(input.identity.shopDomain, input.identity.shopifyCustomerId, cycleKey, shipMonth, now)
      .first<TestBindingRow>();
    if (!row) throw denied();

    try {
      if (
        row.status !== "ACTIVE"
        || row.shop_domain !== input.identity.shopDomain
        || row.shopify_customer_id !== input.identity.shopifyCustomerId
        || row.cycle_key !== cycleKey
        || row.ship_month !== shipMonth
        || asIsoTimestamp(row.expires_at) <= asIsoTimestamp(now)
      ) {
        throw denied();
      }
      return {
        actorRef: asProfileQueueActorRef(row.actor_ref),
        bindingId: asBindingId(row.binding_id),
      };
    } catch {
      throw denied();
    }
  }
}

function denied(): ProfileQueueOwnershipDeniedError {
  return new ProfileQueueOwnershipDeniedError("No active staging test binding authorizes this exact cycle.");
}
