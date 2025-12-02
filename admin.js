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
      msgBox.innerHTML = `<div class="error">${data.error}</div>`;
    } else {
      msgBox.innerHTML = `<div class="success">Order ${orderId} settled successfully!</div>`;
      loadOrders(); // refresh list
    }

  } catch (err) {
    msgBox.innerHTML = `<div class="error">Error: ${err.message}</div>`;
  }
}

// ---------------------- LOAD ORDERS ----------------------
async function loadOrders() {
  const status = document.getElementById("filterStatus").value;
  const customerId = document.getElementById("filterCustomerId").value;

  let params = new URLSearchParams();
  if (status) params.append("status", status);
  if (customerId) params.append("customerId", customerId);

  const endpoint =
    backendUrl() + "/orders" + (params.toString() ? "?" + params.toString() : "");

  try {
    const res = await fetch(endpoint);
    const rows = await res.json();
    renderOrderTable(rows);
  } catch (err) {
    document.getElementById("orderTable").innerHTML =
      `<p class="error">Unable to load orders. Check backend URL.</p>`;
  }
}

// ---------------------- TABLE RENDER ----------------------
function renderOrderTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    document.getElementById("orderTable").innerHTML = "<p>No orders found.</p>";
    return;
  }

  let html = `
    <table>
      <tr>
        <th>Order ID</th>
        <th>Customer</th>
        <th>Amount</th>
        <th>Status</th>
        <th>Date</th>
      </tr>
  `;

  rows.forEach((row) => {
    html += `
      <tr>
        <td>${row.order_id}</td>
        <td>${row.customer_id}</td>
        <td>$${row.order_amount}</td>
        <td>${row.status_id}</td>
        <td>${row.order_date}</td>
      </tr>
    `;
  });

  html += "</table>";
  document.getElementById("orderTable").innerHTML = html;
}

// ---------------------- EVENT LISTENERS ----------------------
document.getElementById("filterBtn").addEventListener("click", loadOrders);
document.getElementById("settleBtn").addEventListener("click", submitSettlement);

// Load on startup
window.addEventListener("DOMContentLoaded", loadOrders);
