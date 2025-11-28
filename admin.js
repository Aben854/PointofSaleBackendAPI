// ---------- Helper ----------
function backendUrl() {
  return document.getElementById("baseUrl").value.replace(/\/+$/, "");
}

// ---------- Settlement ----------
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
      msgBox.innerHTML = `<div class="error">${data.error || "Settlement failed."}</div>`;
    } else {
      msgBox.innerHTML = `<div class="success">Order ${orderId} settled successfully!</div>`;
    }
  } catch (err) {
    msgBox.innerHTML = `<div class="error">Error: ${err.message}</div>`;
  }
}

// ---------- Load Orders ----------
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

// ---------- Render Table ----------
function renderOrderTable(rows) {
  if (!rows.length) {
    document.getElementById("orderTable").innerHTML =
      "<p>No orders found.</p>";
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

// ---------- EVENT LISTENERS (fixed IDs) ----------
document.getElementById("settleButton").addEventListener("click", submitSettlement);
document.getElementById("filterButton").addEventListener("click", loadOrders);

// Auto-load orders on page load
window.addEventListener("DOMContentLoaded", loadOrders);
