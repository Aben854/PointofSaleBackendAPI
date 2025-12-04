// ===============================
//  ADMIN.JS – WORKING VERSION
// ===============================

// BASE URL pulled from input
function backendUrl() {
  return document.getElementById("baseUrl").value.replace(/\/+$/, "");
}

// ---------------------- SETTLEMENT ----------------------
async function submitSettlement() {
  const orderId = document.getElementById("settleOrderId").value.trim();
  const amount = Number(document.getElementById("settleAmount").value);
  const msgBox = document.getElementById("settleMsg");

  msgBox.innerHTML = "";

  if (!orderId || !amount) {
    msgBox.innerHTML = `<div class="error">Missing Order ID or Amount.</div>`;
    return;
  }

  try {
    const res = await fetch(backendUrl() + "/payments/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, amount })
    });

    const data = await res.json();

    if (!res.ok) {
      msgBox.innerHTML = `<div class="error">${data.error || "Settlement failed."}</div>`;
    } else {
      msgBox.innerHTML = `<div class="success">Order ${orderId} settled successfully!</div>`;
      loadOrders(); // refresh list
    }
  } catch (err) {
    console.error("Error in submitSettlement:", err);
    msgBox.innerHTML = `<div class="error">Error: ${err.message}</div>`;
  }
}

// ---------------------- LOAD ORDERS + FILTERS ----------------------
async function loadOrders() {
  const status = document.getElementById("filterStatus").value;
  const customerId = document.getElementById("filterCustomerId").value.trim();

  const endpoint = backendUrl() + "/orders";

  try {
    const res = await fetch(endpoint);
    let rows = await res.json();

    // Front-end filtering 
    if (status) {
      rows = rows.filter((r) => r.status === status);
    }
    if (customerId) {
      rows = rows.filter((r) => String(r.customer_id) === customerId);
    }

    renderOrderTable(rows);
  } catch (err) {
    console.error("Error loading orders:", err);
    document.getElementById("orderTable").innerHTML =
      `<p class="error">Unable to load orders. Check backend URL.</p>`;
  }
}

// ---------------------- TABLE RENDER ----------------------
function renderOrderTable(rows) {
  const container = document.getElementById("orderTable");

  if (!Array.isArray(rows) || rows.length === 0) {
    container.innerHTML = "<p>No orders found.</p>";
    return;
  }

  let html = `
    <table class="orders-table">
      <thead>
        <tr>
          <th>Order ID</th>
          <th>Customer ID</th>
          <th>Amount</th>
          <th>Status</th>
          <th>Created At</th>
        </tr>
      </thead>
      <tbody>
  `;

  rows.forEach((row) => {
    html += `
      <tr>
        <td>${row.order_id}</td>
        <td>${row.customer_id}</td>
        <td>$${Number(row.total_amount).toFixed(2)}</td>
        <td>${row.status}</td>
        <td>${row.created_at}</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

// ---------------------- WIRE UP EVENTS ----------------------
document.addEventListener("DOMContentLoaded", () => {
  const settleBtn = document.getElementById("settleBtn");
  const filterBtn = document.getElementById("filterBtn");

  if (settleBtn) {
    settleBtn.addEventListener("click", submitSettlement);
  }

  if (filterBtn) {
    filterBtn.addEventListener("click", loadOrders);
  }

  // Initial load of orders
  loadOrders();
});