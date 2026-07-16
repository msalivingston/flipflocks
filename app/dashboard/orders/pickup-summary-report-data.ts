export type PickupSummaryExportFormat = "pdf" | "xlsx";
export type PickupSummaryReport = "pull_sheet" | "order_summary";

export type PickupSummaryLine = {
  breedOrVariety: string;
  customerEmail: string | null;
  customerName: string;
  customerPhone: string | null;
  id: string;
  lineValue: number;
  orderId: string;
  orderNumber: string;
  quantity: number;
  readyDate: string | null;
  sex: string | null;
};

export type PickupSummaryPayload = {
  defaultSelectionRule: string;
  exportFormat: PickupSummaryExportFormat;
  includedBirdTotalPerCustomer: Array<{
    customerName: string;
    email: string | null;
    orderId: string;
    orderNumber: string;
    phone: string | null;
    totalBirds: number;
    totalValue: number;
  }>;
  includedOrderLines: PickupSummaryLine[];
  includedOrders: Array<{
    customerName: string;
    email: string | null;
    orderId: string;
    orderNumber: string;
    phone: string | null;
  }>;
  overallBirdTotal: number;
  overallPickupValue: number;
  reports: PickupSummaryReport[];
};

export type PickupSummaryPullSheetRow = {
  breedOrVariety: string;
  quantity: number;
  sex: string;
};

export type PickupSummaryOrderSummaryRow = {
  customerName: string;
  email: string;
  orderId: string;
  orderNumber: string;
  phone: string;
  totalBirds: number;
  totalValue: number;
};

export type PickupSummaryReportData = {
  fileDate: string;
  generatedDateLabel: string;
  orderSummaryRows: PickupSummaryOrderSummaryRow[];
  orderSummaryTotals: {
    birds: number;
    value: number;
  };
  pullSheetRows: PickupSummaryPullSheetRow[];
  pullSheetTotalBirds: number;
  reports: PickupSummaryReport[];
};

export function createPickupSummaryReportData(
  payload: PickupSummaryPayload,
  generatedAt = new Date(),
): PickupSummaryReportData {
  const pullSheetRows = buildPullSheetRows(payload.includedOrderLines);
  const orderSummaryRows = payload.includedBirdTotalPerCustomer
    .map((order) => ({
      customerName: order.customerName,
      email: order.email?.trim() ?? "",
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      phone: order.phone?.trim() ?? "",
      totalBirds: order.totalBirds,
      totalValue: order.totalValue,
    }))
    .sort(compareOrderNumbers);

  return {
    fileDate: toFileDate(generatedAt),
    generatedDateLabel: generatedAt.toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    orderSummaryRows,
    orderSummaryTotals: {
      birds: orderSummaryRows.reduce((total, row) => total + row.totalBirds, 0),
      value: orderSummaryRows.reduce((total, row) => total + row.totalValue, 0),
    },
    pullSheetRows,
    pullSheetTotalBirds: pullSheetRows.reduce(
      (total, row) => total + row.quantity,
      0,
    ),
    reports: payload.reports,
  };
}

function compareOrderNumbers(
  a: PickupSummaryOrderSummaryRow,
  b: PickupSummaryOrderSummaryRow,
) {
  const aNumber = Number(a.orderNumber);
  const bNumber = Number(b.orderNumber);

  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) {
    return aNumber - bNumber;
  }

  return a.orderNumber.localeCompare(b.orderNumber, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function buildPullSheetRows(lines: PickupSummaryLine[]) {
  const rows = new Map<string, PickupSummaryPullSheetRow>();

  lines.forEach((line) => {
    const sex = line.sex?.trim() || "Not specified";
    const key = `${line.breedOrVariety.toLocaleLowerCase()}::${sex.toLocaleLowerCase()}`;
    const existing = rows.get(key);

    if (existing) {
      existing.quantity += line.quantity;
      return;
    }

    rows.set(key, {
      breedOrVariety: line.breedOrVariety,
      quantity: line.quantity,
      sex,
    });
  });

  return Array.from(rows.values()).sort((a, b) => {
    const breedSort = a.breedOrVariety.localeCompare(b.breedOrVariety);
    if (breedSort !== 0) return breedSort;
    return a.sex.localeCompare(b.sex);
  });
}

function toFileDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
