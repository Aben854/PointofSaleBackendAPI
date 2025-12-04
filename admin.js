// ===============================
//  ADMIN.JS – WORKING VERSION
// ===============================

// Return trimmed backend URL
function backendUrl() {
  return document.getElementById("baseUrl").value.replace(/\/+$/, "");
}

// -------------------------------------------
// SUBMIT SETTLEMENT
// -------------------------------------------
async function submitSettlement() {
  const orderId = document.getElementById("settleOrderId").value.trim();
  const amount = Number(document.getElementById("settleAmount").value);
  const msgBox = document.getElementById("settleMsg");

  msgBox.innerHTML = "";

  if (!orderId || !amount) {
    msgBox.innerHTML = `<div class="error">Please enter Order ID and Amount.</div>`;
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
      msgBox.innerHTML = `<div class="error">${data.error}</div>`;
    } else {
      msgBox.innerHTML = `<div class="success">Order ${orderId} settled successfully.</div>`;
    }
  } catch (err) {
    msgBox.innerHTML = `<div class="error">Error: ${err.message}</div>`;
  }
}

// -------------------------------------------
// LOAD ORDERS
// -------------------------------------------
async function loadOrders() {
  const status = document.getElementById("filterStatus").value;
  const customerId = document.getElementById("filterCustomerId").value;

  let query = new URLSearchParams();
  if (status) query.append("status", status);
  if (customerId) query.append("customerId", customerId);

  const url =
    backendUrl() + "/orders" + (query.toString() ? "?" + query.toString() : "");

  try {
    const res = await fetch(url);
    const data = await res.json();

    renderOrderTable(data);
  } catch {
    document.getElementById("orderTable").innerHTML =
      "<p class='error'>Unable to load orders.</p>";
  }
}

// -------------------------------------------
// RENDER TABLE
// -------------------------------------------
function renderOrderTable(rows) {
  if (!rows || rows.length === 0) {
    document.getElementById("orderTable").innerHTML = "<p>No orders found.</p>";
    return;
  }

  let html = `
    <table>
      <tr>
        <th>Order ID</th>
        <th>Customer ID</th>
        <th>Amount</th>
        <th>Status</th>
        <th>Date</th>
      </tr>
  `;

  rows.forEach((o) => {
    html += `
      <tr>
        <td>${o.order_id}</td>
        <td>${o.customer_id}</td>
        <td>$${o.order_amount}</td>
        <td>${o.status_id}</td>
        <td>${o.order_date}</td>
      </tr>
    `;
  });

  html += `</table>`;
  document.getElementById("orderTable").innerHTML = html;
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
