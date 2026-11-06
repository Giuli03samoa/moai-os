/**
 * GraphQL documents for the Shopify Admin API. Page sizes are kept small so that a single
 * query stays under the 1000-point cost ceiling even with nested line items.
 * Optional blocks are included only when the installed app actually has the scope.
 */

export const MONEY = `{ shopMoney { amount currencyCode } }`;

export const SHOP_INFO = /* GraphQL */ `
  query ShopInfo {
    shop { name myshopifyDomain currencyCode ianaTimezone plan { displayName partnerDevelopment shopifyPlus } }
    currentAppInstallation { accessScopes { handle } }
  }
`;

export type ShopInfo = {
  shop: { name: string; myshopifyDomain: string; currencyCode: string; ianaTimezone: string; plan: { displayName: string; partnerDevelopment: boolean; shopifyPlus: boolean } };
  currentAppInstallation: { accessScopes: Array<{ handle: string }> };
};

export function ordersQuery(opts: { customers: boolean; customerPii: boolean; fulfillments: boolean }) {
  const customer = opts.customers
    ? `customer { id numberOfOrders amountSpent { amount currencyCode } createdAt updatedAt ${opts.customerPii ? "displayName email" : ""} }`
    : "";
  const fulfillments = opts.fulfillments
    ? `fulfillments(first: 20) { id status displayStatus createdAt updatedAt deliveredAt inTransitAt trackingInfo { number url company } }`
    : "";
  return /* GraphQL */ `
    query Orders($first: Int!, $after: String, $query: String) {
      orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id name test createdAt processedAt updatedAt cancelledAt closedAt
          currencyCode presentmentCurrencyCode
          displayFinancialStatus displayFulfillmentStatus
          tags paymentGatewayNames
          subtotalPriceSet ${MONEY}
          totalDiscountsSet ${MONEY}
          totalShippingPriceSet ${MONEY}
          totalTaxSet ${MONEY}
          totalPriceSet ${MONEY}
          totalRefundedSet ${MONEY}
          ${customer}
          lineItems(first: 50) {
            nodes { id sku title quantity variant { id } originalUnitPriceSet ${MONEY} totalDiscountSet ${MONEY} }
          }
          transactions(first: 50) {
            id kind status gateway processedAt paymentId
            amountSet ${MONEY}
            fees { amount { amount currencyCode } }
            parentTransaction { id }
          }
          ${fulfillments}
          refunds(first: 20) { id createdAt totalRefundedSet ${MONEY} }
        }
      }
    }
  `;
}

export type Money = { shopMoney: { amount: string; currencyCode: string } };

export type OrderNode = {
  id: string;
  name: string;
  test: boolean;
  createdAt: string;
  processedAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  closedAt: string | null;
  currencyCode: string;
  presentmentCurrencyCode: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  tags: string[];
  paymentGatewayNames: string[];
  subtotalPriceSet: Money;
  totalDiscountsSet: Money;
  totalShippingPriceSet: Money;
  totalTaxSet: Money;
  totalPriceSet: Money;
  totalRefundedSet: Money;
  customer?: { id: string; numberOfOrders: string; amountSpent: { amount: string; currencyCode: string }; createdAt: string; updatedAt: string; displayName?: string; email?: string | null } | null;
  lineItems: { nodes: Array<{ id: string; sku: string | null; title: string; quantity: number; variant: { id: string } | null; originalUnitPriceSet: Money; totalDiscountSet: Money }> };
  transactions: Array<{ id: string; kind: string; status: string; gateway: string | null; processedAt: string | null; paymentId: string | null; amountSet: Money; fees: Array<{ amount: { amount: string; currencyCode: string } }>; parentTransaction: { id: string } | null }>;
  fulfillments?: Array<{ id: string; status: string; displayStatus: string | null; createdAt: string; updatedAt: string; deliveredAt: string | null; inTransitAt: string | null; trackingInfo: Array<{ number: string | null; url: string | null; company: string | null }> }>;
  refunds: Array<{ id: string; createdAt: string; totalRefundedSet: Money }>;
};

export type OrdersResponse = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] } };

export const PRODUCTS = /* GraphQL */ `
  query Products($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle status vendor productType updatedAt
        variants(first: 100) { nodes { id sku title price inventoryQuantity updatedAt inventoryItem { tracked } } }
      }
    }
  }
`;

export type ProductNode = {
  id: string; title: string; handle: string; status: string; vendor: string; productType: string; updatedAt: string;
  variants: { nodes: Array<{ id: string; sku: string | null; title: string; price: string; inventoryQuantity: number | null; updatedAt: string; inventoryItem?: { tracked: boolean } | null }> };
};
export type ProductsResponse = { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ProductNode[] } };

export function customersQuery(pii: boolean) {
  return /* GraphQL */ `
    query Customers($first: Int!, $after: String, $query: String) {
      customers(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
        pageInfo { hasNextPage endCursor }
        nodes { id numberOfOrders amountSpent { amount currencyCode } createdAt updatedAt ${pii ? "displayName email" : ""} }
      }
    }
  `;
}
export type CustomerNode = { id: string; numberOfOrders: string; amountSpent: { amount: string; currencyCode: string }; createdAt: string; updatedAt: string; displayName?: string; email?: string | null };
export type CustomersResponse = { customers: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: CustomerNode[] } };

export const PAYOUTS = /* GraphQL */ `
  query Payouts($first: Int!, $after: String) {
    shopifyPaymentsAccount {
      id
      payouts(first: $first, after: $after, sortKey: ISSUED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id status issuedAt
          net { amount currencyCode }
          gross { amount currencyCode }
          summary {
            chargesFee { amount } chargesGross { amount }
            refundsFee { amount } refundsFeeGross { amount }
            adjustmentsFee { amount } adjustmentsGross { amount }
            reservedFundsFee { amount } reservedFundsGross { amount }
            retriedPayoutsFee { amount } retriedPayoutsGross { amount }
          }
        }
      }
    }
  }
`;
export type PayoutNode = {
  id: string; status: string; issuedAt: string; net: { amount: string; currencyCode: string }; gross: { amount: string; currencyCode: string } | null;
  summary: Record<string, { amount: string } | null> | null;
};
export type PayoutsResponse = { shopifyPaymentsAccount: { id: string; payouts: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: PayoutNode[] } } | null };

export const BALANCE_TRANSACTIONS = /* GraphQL */ `
  query BalanceTransactions($first: Int!, $after: String) {
    shopifyPaymentsAccount {
      balanceTransactions(first: $first, after: $after, sortKey: PROCESSED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id type sourceType sourceId sourceOrderTransactionId transactionDate test
          amount { amount currencyCode }
          fee { amount currencyCode }
          net { amount currencyCode }
          adjustmentReason
          associatedPayout { id status }
          associatedOrder { id name }
        }
      }
    }
  }
`;
export type BalanceTxNode = {
  id: string; type: string; sourceType: string | null; sourceId: string | null; sourceOrderTransactionId: string | null; transactionDate: string; test: boolean;
  amount: { amount: string; currencyCode: string }; fee: { amount: string; currencyCode: string }; net: { amount: string; currencyCode: string };
  adjustmentReason: string | null; associatedPayout: { id: string; status: string } | null; associatedOrder: { id: string; name: string } | null;
};
export type BalanceTxResponse = { shopifyPaymentsAccount: { balanceTransactions: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: BalanceTxNode[] } } | null };

/** gid://shopify/Order/123 → 123 */
export function legacyId(gid: string): string {
  return gid.split("/").pop()?.split("?")[0] ?? gid;
}

export function gid(type: string, id: string | number) {
  return `gid://shopify/${type}/${id}`;
}
