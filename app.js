const STORAGE_KEY = "qt-food-invoices-v1";

const fields = [
  "invoiceId",
  "taxAmountOverride",
  "grossAmountOverride",
  "sellerName",
  "sellerAddress",
  "sellerGstin",
  "invoiceNo",
  "invoiceDate",
  "paymentTerms",
  "otherReferences",
  "buyerOrderNo",
  "destination",
  "consigneeName",
  "consigneeAddress",
  "buyerName",
  "buyerAddress",
  "buyerGstin",
  "taxMode",
  "taxRate",
  "termsOfDelivery",
];

const els = {};
let invoices = [];
let isPreviewEditMode = false;
let excelBatch = [];
let excelBatchIndex = -1;

document.addEventListener("DOMContentLoaded", () => {
  fields.forEach((id) => {
    els[id] = document.getElementById(id);
  });

  els.itemsEditor = document.getElementById("itemsEditor");
  els.invoicePaper = document.getElementById("invoicePaper");
  els.invoiceForm = document.getElementById("invoiceForm");
  els.historyList = document.getElementById("historyList");
  els.historySearch = document.getElementById("historySearch");
  els.saveState = document.getElementById("saveState");
  els.roundOffDisplay = document.getElementById("roundOffDisplay");
  els.excelStatus = document.getElementById("excelStatus");
  els.batchCounter = document.getElementById("batchCounter");

  els.invoiceDate.value = "2023-10-18";
  invoices = loadInvoices();
  addItem({ description: "MACHINES", quantity: "", rate: "", per: "", amount: 1314915.25 });
  bindEvents();
  render();
  renderHistory();
});

function bindEvents() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  els.invoiceForm.addEventListener("input", (event) => {
    if (isPreviewEditMode) {
      isPreviewEditMode = false;
      els.invoicePaper.contentEditable = "false";
      els.invoicePaper.classList.remove("editing");
      document.getElementById("previewEditBtn").textContent = "Edit Preview";
    }
    if (event.target?.id === "taxAmountOverride") {
      els.grossAmountOverride.value = "";
    }
    els.saveState.textContent = "Unsaved";
    render();
  });

  els.invoiceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveInvoice();
  });

  document.getElementById("addItemBtn").addEventListener("click", () => {
    addItem({ description: "", quantity: "", rate: "", per: "", amount: "" });
    render();
  });

  document.getElementById("downloadBtn").addEventListener("click", () => downloadCurrentPdf());
  document.getElementById("resetBtn").addEventListener("click", resetForm);
  document.getElementById("excelInput").addEventListener("change", handleExcel);
  document.getElementById("clearHistoryBtn").addEventListener("click", clearHistory);
  document.getElementById("downloadAllBtn").addEventListener("click", downloadAllInvoices);
  document.getElementById("previewEditBtn").addEventListener("click", togglePreviewEdit);
  document.getElementById("prevBillBtn").addEventListener("click", () => moveBatch(-1));
  document.getElementById("nextBillBtn").addEventListener("click", () => moveBatch(1));
  els.taxRate.addEventListener("input", syncTaxAmountFromItems);
  els.historySearch.addEventListener("input", renderHistory);
  updateBatchCounter();
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.remove("active"));
  document.getElementById(`${name}Tab`).classList.add("active");
}

function addItem(item) {
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <label>Description<input class="item-description" value="${escapeAttr(item.description || "")}"></label>
    <label>Qty<input class="item-quantity" value="${escapeAttr(item.quantity || "")}"></label>
    <label>Rate<input class="item-rate" type="number" step="0.01" value="${escapeAttr(item.rate || "")}"></label>
    <label>Per<input class="item-per" value="${escapeAttr(item.per || "")}"></label>
    <label>Amount<input class="item-amount" type="number" step="0.01" value="${escapeAttr(item.amount || "")}"></label>
    <button class="icon-btn" type="button" title="Remove item">x</button>
  `;
  row.querySelector(".icon-btn").addEventListener("click", () => {
    row.remove();
    render();
  });
  ["item-quantity", "item-rate"].forEach((className) => {
    row.querySelector(`.${className}`).addEventListener("input", () => autoAmount(row));
  });
  row.querySelector(".item-amount").addEventListener("input", syncTaxAmountFromItems);
  els.itemsEditor.appendChild(row);
}

function autoAmount(row) {
  const qty = parseFloat(row.querySelector(".item-quantity").value);
  const rate = parseFloat(row.querySelector(".item-rate").value);
  if (Number.isFinite(qty) && Number.isFinite(rate)) {
    row.querySelector(".item-amount").value = round2(qty * rate);
    syncTaxAmountFromItems();
  }
}

function collectData() {
  const data = {};
  fields.forEach((id) => {
    data[id] = els[id].value.trim();
  });
  data.items = Array.from(els.itemsEditor.querySelectorAll(".item-row")).map((row) => {
    const quantity = row.querySelector(".item-quantity").value.trim();
    const rate = row.querySelector(".item-rate").value.trim();
    const manualAmount = row.querySelector(".item-amount").value.trim();
    const amount = parseFloat(manualAmount) || (parseFloat(quantity) || 0) * (parseFloat(rate) || 0);
    return {
      description: row.querySelector(".item-description").value.trim(),
      quantity,
      rate,
      per: row.querySelector(".item-per").value.trim(),
      amount,
    };
  }).filter((item) => item.description || item.amount);
  data.taxRate = parseFloat(data.taxRate) || 0;
  data.taxMode = data.taxMode || "IGST";
  data.baseTotal = data.items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const manualTax = parseNumber(data.taxAmountOverride);
  const manualGross = parseNumber(data.grossAmountOverride);
  data.taxAmount = manualTax > 0 ? round2(manualTax) : round2((data.baseTotal * data.taxRate) / 100);
  data.totalBeforeRound = manualGross > 0 ? round2(manualGross) : round2(data.baseTotal + data.taxAmount);
  data.total = Math.round(data.totalBeforeRound);
  data.roundOff = round2(data.total - data.totalBeforeRound);
  if (els.roundOffDisplay) els.roundOffDisplay.value = money(data.roundOff, false);
  data.updatedAt = new Date().toISOString();
  return data;
}

function fillForm(data) {
  if (isPreviewEditMode) {
    isPreviewEditMode = false;
    els.invoicePaper.contentEditable = "false";
    els.invoicePaper.classList.remove("editing");
    document.getElementById("previewEditBtn").textContent = "Edit Preview";
  }
  fields.forEach((id) => {
    if (id in data) els[id].value = data[id] || "";
  });
  els.itemsEditor.innerHTML = "";
  (data.items || []).forEach(addItem);
  if (!data.items || data.items.length === 0) addItem({ description: "", quantity: "", rate: "", per: "", amount: "" });
  render();
}

function saveInvoice() {
  const data = collectData();
  data.invoiceId = data.invoiceId || crypto.randomUUID();
  els.invoiceId.value = data.invoiceId;
  const index = invoices.findIndex((invoice) => invoice.invoiceId === data.invoiceId);
  if (index >= 0) invoices[index] = data;
  else invoices.unshift(data);
  persist();
  els.saveState.textContent = "Saved";
  renderHistory();
}

function resetForm() {
  els.invoiceId.value = "";
  els.taxAmountOverride.value = "";
  els.grossAmountOverride.value = "";
  els.invoiceNo.value = nextInvoiceNo();
  els.invoiceDate.value = new Date().toISOString().slice(0, 10);
  els.paymentTerms.value = "";
  els.otherReferences.value = "";
  els.buyerOrderNo.value = "";
  els.destination.value = "";
  els.taxMode.value = "IGST";
  els.taxAmountOverride.value = "";
  els.grossAmountOverride.value = "";
  els.itemsEditor.innerHTML = "";
  addItem({ description: "", quantity: "", rate: "", per: "", amount: "" });
  els.saveState.textContent = "Unsaved";
  render();
}

function syncTaxAmountFromItems() {
  const baseTotal = Array.from(els.itemsEditor.querySelectorAll(".item-amount"))
    .reduce((sum, input) => sum + parseNumber(input.value), 0);
  const taxRate = parseNumber(els.taxRate.value);
  els.taxAmountOverride.value = baseTotal && taxRate ? round2((baseTotal * taxRate) / 100) : "";
  els.grossAmountOverride.value = "";
}

function render() {
  if (isPreviewEditMode) return;
  const data = collectData();
  const first = data.items[0] || {};
  const chargeLines = taxChargeLines(data);
  const chargeLabels = [
    ...chargeLines.map((line) => `${line.label} (${line.rate}%)`),
    "Round Off",
  ];
  const chargeAmounts = [
    ...chargeLines.map((line) => money(line.amount, false)),
    money(data.roundOff, false),
  ];
  els.invoicePaper.innerHTML = `
    <div class="invoice-title">INVOICE</div>
    <div class="tally-box">
      <div class="top-grid">
        <div class="left-block">
          <div class="seller-block">
            <div class="bold">${escapeHtml(data.sellerName)}</div>
            <div>${lines(data.sellerAddress)}</div>
            <div>${escapeHtml(data.sellerGstin)}</div>
          </div>
          <div class="party-block">
            <div class="caption">Consignee (Ship to)</div>
            <div class="bold">${escapeHtml(data.consigneeName)}</div>
            <div>${lines(data.consigneeAddress)}</div>
          </div>
          <div class="party-block">
            <div class="caption">Buyer (Bill to)</div>
            <div class="bold">${escapeHtml(data.buyerName)}</div>
            <div>${lines(data.buyerAddress)}</div>
            <div>${escapeHtml(data.buyerGstin)}</div>
          </div>
        </div>
        <div class="right-grid">
          ${metaCell("Invoice No.", data.invoiceNo, true)}
          ${metaCell("Dated", formatDate(data.invoiceDate), true)}
          ${metaCell("Delivery Note", "")}
          ${metaCell("Mode/Terms of Payment", data.paymentTerms)}
          ${metaCell("Reference No. & Date.", "")}
          ${metaCell("Other References", data.otherReferences)}
          ${metaCell("Buyer's Order No.", data.buyerOrderNo)}
          ${metaCell("Dated", "")}
          ${metaCell("Dispatch Doc No.", "")}
          ${metaCell("Delivery Note Date", "")}
          ${metaCell("Dispatched through", "")}
          ${metaCell("Destination", data.destination)}
          <div class="meta-cell meta-wide">Terms of Delivery<br>${escapeHtml(data.termsOfDelivery)}</div>
        </div>
      </div>
      <table class="goods-table">
        <thead>
          <tr>
            <th class="sl">Sl<br>No.</th>
            <th class="desc">Description of Goods</th>
            <th class="qty">Quantity</th>
            <th class="rate">Rate</th>
            <th class="per">per</th>
            <th class="amt">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${data.items.length ? "1" : ""}</td>
            <td>
              <div class="bold">${escapeHtml(first.description || "")}</div>
              ${data.items.slice(1).map((item) => `<div class="bold">${escapeHtml(item.description)}</div>`).join("")}
              <div class="charge-lines">${chargeLabels.map((label) => `<div>${escapeHtml(label)}</div>`).join("")}</div>
            </td>
            <td>${data.items.map((item) => escapeHtml(item.quantity)).join("<br>")}</td>
            <td>${data.items.map((item) => item.rate ? money(item.rate, false) : "").join("<br>")}</td>
            <td>${data.items.map((item) => escapeHtml(item.per)).join("<br>")}</td>
            <td class="amt">
              ${data.items.map((item) => money(item.amount, false)).join("<br>")}
              <div class="charge-lines">${chargeAmounts.map((amount) => `<div>${amount}</div>`).join("")}</div>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="total-row">
        <div style="text-align:right">Total</div>
        <div></div>
        <div></div>
        <div></div>
        <div>&#8377; ${money(data.total, false)}</div>
      </div>
      <div class="amount-words">
        <div>Amount Chargeable (in words)<span style="float:right">E. &amp; O.E</span></div>
        <div class="bold">${numberToIndianWords(data.total)}</div>
      </div>
      <div class="bottom-grid">
        <div class="declaration">
          <div>Declaration</div>
          <div>We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</div>
        </div>
        <div class="signatory">
          <div class="bold">for ${escapeHtml(data.sellerName)}</div>
          <div class="signature-mark">Sr</div>
          <div>Authorised Signatory</div>
        </div>
      </div>
    </div>
    <div class="generated">This is a Computer Generated Invoice</div>
  `;
}

function taxChargeLines(data) {
  if (data.taxMode === "CGST_SGST") {
    const halfRate = round2(data.taxRate / 2);
    const halfAmount = round2(data.taxAmount / 2);
    return [
      { label: "CGST", rate: halfRate, amount: halfAmount },
      { label: "SGST", rate: halfRate, amount: round2(data.taxAmount - halfAmount) },
    ];
  }
  return [{ label: "IGST", rate: data.taxRate, amount: data.taxAmount }];
}

function metaCell(label, value, strong = false) {
  return `<div class="meta-cell">${escapeHtml(label)}<br><span class="${strong ? "bold" : ""}">${escapeHtml(value)}</span></div>`;
}

async function downloadCurrentPdf(dataOverride) {
  const data = dataOverride || collectData();
  if (dataOverride) {
    fillForm(dataOverride);
  }
  if (!window.jspdf || !window.html2canvas) {
    alert("PDF library is still loading. Try again in a few seconds.");
    return;
  }
  if (!isPreviewEditMode) render();
  const canvas = await html2canvas(els.invoicePaper, { scale: 2, backgroundColor: "#ffffff" });
  const imgData = canvas.toDataURL("image/png");
  const pdf = new window.jspdf.jsPDF("p", "mm", "a4");
  pdf.addImage(imgData, "PNG", 0, 0, 210, 297);
  pdf.save(`invoice-${data.invoiceNo || "draft"}.pdf`);
}

async function downloadAllInvoices() {
  if (!invoices.length) {
    alert("History me koi invoice nahi hai.");
    return;
  }
  els.saveState.textContent = `Downloading ${invoices.length} bills...`;
  for (const invoice of invoices.slice().reverse()) {
    await downloadCurrentPdf(invoice);
    await wait(450);
  }
  els.saveState.textContent = "All bills downloaded";
}

function togglePreviewEdit() {
  isPreviewEditMode = !isPreviewEditMode;
  els.invoicePaper.contentEditable = isPreviewEditMode ? "true" : "false";
  els.invoicePaper.classList.toggle("editing", isPreviewEditMode);
  document.getElementById("previewEditBtn").textContent = isPreviewEditMode ? "Lock Preview" : "Edit Preview";
  els.saveState.textContent = isPreviewEditMode ? "Preview editable" : "Preview locked";
}

function renderHistory() {
  const query = (els.historySearch?.value || "").toLowerCase();
  const visible = invoices.filter((invoice) => {
    return [invoice.invoiceNo, invoice.buyerName, invoice.consigneeName, invoice.total]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  if (!visible.length) {
    els.historyList.innerHTML = `<div class="empty">No invoices saved yet.</div>`;
    return;
  }
  els.historyList.innerHTML = visible.map((invoice) => `
    <article class="history-card">
      <strong>Invoice ${escapeHtml(invoice.invoiceNo || "-")} - ${money(invoice.total)}</strong>
      <span>${escapeHtml(invoice.buyerName || "No buyer")} | ${formatDate(invoice.invoiceDate)} | ${invoice.items?.length || 0} item(s)</span>
      <div class="history-actions">
        <button type="button" data-action="edit" data-id="${invoice.invoiceId}">Edit</button>
        <button type="button" data-action="download" data-id="${invoice.invoiceId}">Download</button>
        <button class="danger" type="button" data-action="delete" data-id="${invoice.invoiceId}">Delete</button>
      </div>
    </article>
  `).join("");

  els.historyList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => handleHistoryAction(button.dataset.action, button.dataset.id));
  });
}

function handleHistoryAction(action, id) {
  const invoice = invoices.find((item) => item.invoiceId === id);
  if (!invoice) return;
  if (action === "edit") {
    fillForm(invoice);
    switchTab("form");
    els.saveState.textContent = "Loaded";
  }
  if (action === "download") downloadCurrentPdf(invoice);
  if (action === "delete" && confirm("Delete this invoice from history?")) {
    invoices = invoices.filter((item) => item.invoiceId !== id);
    persist();
    renderHistory();
  }
}

function clearHistory() {
  if (!invoices.length || !confirm("Clear all saved invoices?")) return;
  invoices = [];
  persist();
  renderHistory();
}

async function handleExcel(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!window.XLSX) {
    alert("Excel library is still loading. Try again in a few seconds.");
    return;
  }
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: false });
  const rows = excelMatrixToRows(matrix);
  if (!rows.length) {
    alert("Excel me data rows nahi mili.");
    return;
  }

  const imported = buildInvoicesFromExcel(rows);
  if (!imported.length) return;
  excelBatch = imported;
  excelBatchIndex = 0;
  invoices = [...imported, ...invoices.filter((old) => !imported.some((fresh) => fresh.invoiceId === old.invoiceId))];
  persist();
  fillForm(excelBatch[excelBatchIndex]);
  renderHistory();
  updateBatchCounter();
  els.excelStatus.textContent = `${imported.length} bills ready from Excel. Use Next Bill.`;
  els.saveState.textContent = `Excel bill 1 of ${imported.length}`;
  event.target.value = "";
}

function moveBatch(direction) {
  if (!excelBatch.length) {
    alert("Pehle Excel upload karo.");
    return;
  }
  const current = collectData();
  if (current.invoiceId) {
    const batchIndex = excelBatch.findIndex((invoice) => invoice.invoiceId === current.invoiceId);
    if (batchIndex >= 0) excelBatch[batchIndex] = current;
    const historyIndex = invoices.findIndex((invoice) => invoice.invoiceId === current.invoiceId);
    if (historyIndex >= 0) invoices[historyIndex] = current;
    persist();
    renderHistory();
  }
  excelBatchIndex = Math.min(Math.max(excelBatchIndex + direction, 0), excelBatch.length - 1);
  fillForm(excelBatch[excelBatchIndex]);
  updateBatchCounter();
  els.saveState.textContent = `Excel bill ${excelBatchIndex + 1} of ${excelBatch.length}`;
}

function updateBatchCounter() {
  if (!els.batchCounter) return;
  els.batchCounter.textContent = excelBatch.length
    ? `${excelBatchIndex + 1} / ${excelBatch.length}`
    : "No Excel batch";
}

function excelMatrixToRows(matrix) {
  const headerIndex = matrix.findIndex((row) => row.some((cell) => normalizeKey(cell) === "bill_date"));
  if (headerIndex < 0) return matrixToGenericRows(matrix);
  return matrix.slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell).trim() !== ""))
    .map((row) => ({
      bill_date: row[0],
      fy: row[1],
      assets_group: row[2],
      assets_name: row[6] || row[3],
      bill_no: row[5],
      vendor_name: row[7],
      gst: row[8],
      amount: row[9],
      taxable_value: row[10],
      gst_2: row[11],
    }))
    .filter((row) => row.bill_date || row.bill_no || row.vendor_name || row.amount || row.taxable_value);
}

function matrixToGenericRows(matrix) {
  const [headers = [], ...dataRows] = matrix;
  const keys = headers.map(normalizeKey);
  return dataRows
    .filter((row) => row.some((cell) => String(cell).trim() !== ""))
    .map((row) => {
      const obj = {};
      keys.forEach((key, index) => {
        if (!key) return;
        obj[key] = row[index];
      });
      return normalizeRow(obj);
    });
}

function buildInvoicesFromExcel(rows) {
  const current = collectData();
  const startNo = parseInt(nextInvoiceNo(), 10) || 1;
  return rows.map((row, index) => {
    const taxableValue = parseNumber(pick(row, ["taxable_value", "taxable", "net_amount"]));
    const taxFromExcel = parseNumber(pick(row, ["gst_2", "gst_1", "tax_amount", "gst_amount"]));
    const grossAmount = parseNumber(pick(row, ["amount", "total", "gross_amount"]));
    const derivedTaxRate = taxableValue ? round2((taxFromExcel / taxableValue) * 100) : current.taxRate;
    const invoiceNo = String(pick(row, ["invoice_no", "invoice", "bill_no", "bill"]) || startNo + index);
    const sellerGstin = pick(row, ["vendor_gst", "seller_gst", "gst", "gstin"]);
    const data = {
      ...current,
      invoiceId: crypto.randomUUID(),
      invoiceNo,
      sellerName: pick(row, ["vendor_name", "seller_name", "vendor"]) || current.sellerName,
      sellerGstin: sellerGstin || current.sellerGstin,
      invoiceDate: excelDate(pick(row, ["bill_date", "date", "invoice_date"])) || current.invoiceDate,
      paymentTerms: pick(row, ["payment_terms", "mode_terms_of_payment"]) || current.paymentTerms,
      otherReferences: pick(row, ["other_references"]) || current.otherReferences,
      buyerOrderNo: pick(row, ["buyer_order_no", "buyers_order_no"]) || current.buyerOrderNo,
      destination: pick(row, ["destination"]) || current.destination,
      buyerName: pick(row, ["buyer", "buyer_name"]) || current.buyerName,
      buyerAddress: pick(row, ["buyer_address"]) || current.buyerAddress,
      buyerGstin: pick(row, ["buyer_gstin"]) || current.buyerGstin,
      consigneeName: pick(row, ["consignee", "consignee_name"]) || current.consigneeName,
      consigneeAddress: pick(row, ["consignee_address"]) || current.consigneeAddress,
      taxMode: taxModeFromExcel(pick(row, ["tax_type", "tax_mode"]) || current.taxMode),
      taxRate: parseFloat(pick(row, ["igst", "tax", "tax_rate"]) || derivedTaxRate || current.taxRate) || 0,
      taxAmountOverride: taxFromExcel || "",
      grossAmountOverride: grossAmount || "",
      items: [excelRowToItem(row)].filter((item) => item.description || item.amount),
    };
    const totals = calculateTotals(data.items, data.taxRate, taxFromExcel, grossAmount);
    return { ...data, ...totals, updatedAt: new Date().toISOString() };
  });
}

function excelRowToItem(row) {
  const quantity = pick(row, ["quantity", "qty"]) || "";
  const rate = pick(row, ["rate"]) || "";
  const taxableValue = parseNumber(pick(row, ["taxable_value", "taxable", "net_amount"]));
  const amount = taxableValue || parseNumber(pick(row, ["amount", "total", "gross_amount"])) || ((parseFloat(quantity) || 0) * (parseFloat(rate) || 0));
  return {
    description: pick(row, ["description", "item", "goods", "product", "assets_name", "asset_name"]) || "MACHINES",
    quantity,
    rate,
    per: pick(row, ["per", "unit"]) || "",
    amount,
  };
}

function taxModeFromExcel(value) {
  const text = String(value || "").toUpperCase();
  return text.includes("CGST") ? "CGST_SGST" : "IGST";
}

function calculateTotals(items, taxRate, taxAmountOverride, grossAmountOverride) {
  const baseTotal = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
  const calculatedTax = round2((baseTotal * (parseFloat(taxRate) || 0)) / 100);
  const taxAmount = Number.isFinite(taxAmountOverride) && taxAmountOverride > 0 ? round2(taxAmountOverride) : calculatedTax;
  const calculatedGross = round2(baseTotal + taxAmount);
  const totalBeforeRound = Number.isFinite(grossAmountOverride) && grossAmountOverride > 0 ? round2(grossAmountOverride) : calculatedGross;
  const total = Math.round(totalBeforeRound);
  const roundOff = round2(total - totalBeforeRound);
  return { baseTotal, taxAmount, totalBeforeRound, total, roundOff };
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return "";
}

function parseNumber(value) {
  const number = parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRow(row) {
  const normalized = {};
  const counts = {};
  Object.entries(row).forEach(([key, value]) => {
    const base = String(key).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "blank";
    counts[base] = (counts[base] || 0) + 1;
    const finalKey = counts[base] === 1 ? base : `${base}_${counts[base]}`;
    normalized[finalKey] = value;
  });
  return normalized;
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function setIfPresent(id, value) {
  if (value !== undefined && value !== null && value !== "") els[id].value = value;
}

function excelDate(value) {
  if (!value) return "";
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  const text = String(value).trim();
  if (/^\d{4,6}$/.test(text) && window.XLSX?.SSF) {
    const date = XLSX.SSF.parse_date_code(Number(text));
    if (date) return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  const indian = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (indian) {
    const year = indian[3].length === 2 ? `20${indian[3]}` : indian[3];
    return `${year}-${indian[2].padStart(2, "0")}-${indian[1].padStart(2, "0")}`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
}

function loadInvoices() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(invoices));
}

function nextInvoiceNo() {
  const nums = invoices.map((invoice) => parseInt(invoice.invoiceNo, 10)).filter(Number.isFinite);
  return String(nums.length ? Math.max(...nums) + 1 : 1);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }).replace(/ /g, "-");
}

function money(value, symbol = false) {
  const amount = Number(value) || 0;
  const formatted = amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return symbol ? `INR ${formatted}` : formatted;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function numberToIndianWords(value) {
  const number = Math.round(Number(value) || 0);
  if (!number) return "INR Zero Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n) => n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]} ${ones[n % 10]}`.trim();
  const three = (n) => {
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    return `${hundred ? `${ones[hundred]} Hundred ` : ""}${rest ? two(rest) : ""}`.trim();
  };
  const parts = [];
  let n = number;
  const crore = Math.floor(n / 10000000);
  if (crore) parts.push(`${three(crore)} Crore`);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  if (lakh) parts.push(`${three(lakh)} Lakh`);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  if (thousand) parts.push(`${three(thousand)} Thousand`);
  n %= 1000;
  if (n) parts.push(three(n));
  return `INR ${parts.join(" ")} Only`;
}

function lines(value) {
  return escapeHtml(value || "").replace(/\n/g, "<br>");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
