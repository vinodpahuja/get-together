const billIndexKey = 'gathering-bills-index';
const currentBillKey = 'gathering-current-bill';
const billDataKey = billId => `gathering-bill-data-${billId}`;
const icons = {
  remove: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>'
};
const decodeField = value => decodeURIComponent(value || '');

// Encode structural delimiters too, so a name containing commas or pipes cannot corrupt the token layout.
const encodeField = value => encodeURIComponent(String(value ?? '')).replace(/[!'()*@,|~+;=]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

// Accept only the core collections needed by render and calculation paths before using imported data.
const isBillState = value => value && Array.isArray(value.people) && Array.isArray(value.payers) && Array.isArray(value.expenses) && value.expenses.every(expense => Array.isArray(expense.rows) && Array.isArray(expense.payments));
const shareToken = location.hash.startsWith('#data=') ? location.hash.slice(6) : '';

// Expand the compact URL format into the same normalized records used by local bills.
const decodeReadableShare = token => {
  const sections = token.split('|');
  const familyEntries = sections.shift().split(',').filter(Boolean).map((entry, index) => {
    const separator = entry.indexOf('-');
    return { id: `family-${index + 1}`, name: `Family ${index + 1}`, headName: decodeField(entry.slice(separator + 1)) };
  });
  const payers = familyEntries.map((family, index) => ({ id: `head-${index + 1}`, name: family.headName, familyId: family.id }));
  const expenses = sections.filter(Boolean).map((entry, index) => {
    const [item, ...details] = entry.split(',');
    const separator = item.indexOf('@');
    const title = decodeField(item.slice(0, separator));
    const unitPrice = Number(item.slice(separator + 1)) || 0;
    let equalShare = false;
    const rows = [];
    const payments = [];
    details.filter(Boolean).forEach(detail => {
      if (detail === 'EQ') equalShare = true;
      else if (/^F\d+\+/.test(detail)) {
        const match = detail.match(/^F(\d+)\+(.+)$/);
        const family = familyEntries[Number(match[1]) - 1];
        if (family) rows.push({ id: `row-${index + 1}-${match[1]}`, personId: family.id, count: Number(match[2]) || 0 });
      } else if (/^P\d+\+/.test(detail)) {
        const match = detail.match(/^P(\d+)\+(.+)$/);
        const payer = payers[Number(match[1]) - 1];
        if (payer) payments.push({ id: `payment-${index + 1}-${match[1]}`, payerId: payer.id, amount: Number(match[2]) || 0 });
      }
    });
    return { id: `expense-${index + 1}`, title, unitPrice, equalShare, rows, payments };
  });
  return { people: familyEntries, payers, expenses };
};
let currentBillId = '';
let lastSavedToken = '';

// All UI totals and edits derive from this normalized model; payer.familyId links payments to a family.
let state = { people: [], payers: [], expenses: [] };

const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(Number(value) || 0);

// Escape user-provided values before interpolating them into generated HTML or attributes.
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const id = prefix => prefix + '-' + Math.random().toString(36).slice(2, 10);
const rowTotal = (expense, row) => (Number(row.count) || 0) * (Number(expense.unitPrice) || 0);
const expenseTotal = expense => expense.equalShare ? Number(expense.unitPrice) || 0 : expense.rows.reduce((sum, row) => sum + rowTotal(expense, row), 0);
const expensePaid = expense => expense.payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
const expensePersonTotal = (expense, personId) => {
  if (!expense.equalShare) return expense.rows.filter(row => row.personId === personId).reduce((sum, row) => sum + rowTotal(expense, row), 0);
  const familyIndex = state.people.findIndex(family => family.id === personId);
  if (familyIndex < 0 || !state.people.length) return 0;
  
  // Split in paise and assign leftover paise by family order so equal shares always balance.
  const totalPaise = Math.round((Number(expense.unitPrice) || 0) * 100);
  return (Math.floor(totalPaise / state.people.length) + (familyIndex < totalPaise % state.people.length ? 1 : 0)) / 100;
};
const personTotal = personId => state.expenses.reduce((sum, expense) => sum + expensePersonTotal(expense, personId), 0);
const payerTotal = payerId => state.expenses.reduce((sum, expense) => sum + expense.payments.filter(payment => payment.payerId === payerId).reduce((subtotal, row) => subtotal + (Number(row.amount) || 0), 0), 0);
const toPaise = amount => Math.round((Number(amount) || 0) * 100);

// A payer whose family was removed is intentionally treated as unlinked, so settlement can flag it.
const payerFamilyId = payer => state.people.some(family => family.id === payer.familyId) ? payer.familyId : '';
const payerForFamily = familyId => state.payers.find(payer => payerFamilyId(payer) === familyId);
const familyName = family => {
  const headName = payerForFamily(family.id)?.name.trim();
  return headName ? `${headName}'s family` : family.name || 'Unnamed family';
};

// Keep the sortable bill list separate from each bill payload; malformed index data should not block startup.
const loadBillIndex = () => { try { return JSON.parse(localStorage.getItem(billIndexKey)) || []; } catch { return []; } };
const saveBillIndex = list => localStorage.setItem(billIndexKey, JSON.stringify(list));
const createBill = (token, name) => {
  const billId = id('bill');
  localStorage.setItem(billDataKey(billId), token);
  const list = loadBillIndex();
  list.push({ id: billId, name, updatedAt: Date.now() });
  saveBillIndex(list);
  return billId;
};
const updateBillToken = (billId, token) => {
  localStorage.setItem(billDataKey(billId), token);
  const list = loadBillIndex();
  const entry = list.find(bill => bill.id === billId);
  if (entry) { entry.updatedAt = Date.now(); saveBillIndex(list); }
};
const deleteBill = billId => {
  localStorage.removeItem(billDataKey(billId));
  saveBillIndex(loadBillIndex().filter(bill => bill.id !== billId));
  
  // Clear the active pointer too; otherwise startup would keep asking for a bill that no longer exists.
  if (currentBillId === billId) { currentBillId = ''; localStorage.removeItem(currentBillKey); }
};
const setCurrentBill = billId => {
  currentBillId = billId;
  localStorage.setItem(currentBillKey, billId);
};
const loadStateFromBill = billId => {
  const token = localStorage.getItem(billDataKey(billId));
  if (!token) return null;
  try {
    const decoded = decodeReadableShare(token);
    return isBillState(decoded) ? decoded : null;  
  // Corrupt or outdated saved tokens are ignored so the rest of the app can still open.
  } catch { return null; }
};
const suggestBillName = () => {
  const headName = state.payers.map(payer => payer.name?.trim()).find(Boolean);
  return headName ? `${headName}'s bill` : `Bill ${new Date().toLocaleDateString()}`;
};
const persist = () => {
  const token = buildShareToken();
  if (!currentBillId) setCurrentBill(createBill(token, suggestBillName()));
  else updateBillToken(currentBillId, token);
  
  // Compare future edits with the exact serialized snapshot just written to storage.
  lastSavedToken = token;
};
const hasUnsavedChanges = () => buildShareToken() !== lastSavedToken;
const options = (list, selectedId, emptyLabel, labelFor = entry => entry.name) => {
  const placeholder = `<option value="">${safe(emptyLabel)}</option>`;
  return placeholder + list.map(entry => `<option value="${safe(entry.id)}" ${entry.id === selectedId ? 'selected' : ''}>${safe(labelFor(entry) || 'Unnamed')}</option>`).join('');
};
const removeButton = (type, expenseId, rowId) => {
  const label = type === 'remove-expense' ? 'Delete item' : type === 'remove-payment' ? 'Remove contribution' : 'Remove row';
  return `<button class="btn btn-sm btn-outline-danger" type="button" data-action="${type}" data-expense="${safe(expenseId)}" data-row="${safe(rowId || '')}" aria-label="${label}" title="${label}">${icons.remove}</button>`;
};

function renderExpense(expense, index) {
  // Manual allocations render one quantity row per family; equal-share items omit those editable rows.
  const rows = expense.equalShare ? '' : state.people.map(family => {
    
    // Supply a display-only row when older/imported data has no allocation yet; the event handler resolves by family ID.
    const row = expense.rows.find(entry => entry.personId === family.id) || { id: `allocation-${expense.id}-${family.id}`, personId: family.id, count: 0 };
    return `
    <div class="row g-2 align-items-center expense-allocation-row">
      <div class="col"><span data-family-name="${safe(family.id)}">${safe(familyName(family))}</span></div>
      <div class="col-3"><input class="form-control form-control-sm text-end" type="number" min="0" step="1" value="${safe(row.count ?? 0)}" placeholder="0" aria-label="${safe(familyName(family))} quantity" data-kind="row" data-expense="${safe(expense.id)}" data-row="${safe(row.id)}" data-family="${safe(family.id)}" data-field="count"></div>
    </div>`;
  }).join('');
  const payments = expense.payments.map(payment => `
    <div class="row g-2 align-items-center expense-payment-row">
      <div class="col"><select class="form-select form-select-sm" aria-label="Family head" data-kind="payment" data-expense="${safe(expense.id)}" data-row="${safe(payment.id)}" data-field="payerId">${options(state.payers, payment.payerId, 'Choose family head')}</select></div>
      <div class="col-4"><div class="input-group input-group-sm"><span class="input-group-text">₹</span><input class="form-control text-end" type="number" min="0" step="0.01" value="${safe(payment.amount)}" placeholder="0.00" aria-label="Contribution amount" data-kind="payment" data-expense="${safe(expense.id)}" data-row="${safe(payment.id)}" data-field="amount"></div></div>
      <div class="col-auto">${removeButton('remove-payment', expense.id, payment.id)}</div>
    </div>`).join('');
  return `<article class="card" data-expense-card="${safe(expense.id)}">
    <div class="card-header bg-body d-flex align-items-center gap-2 expense-card-header">
      <span class="badge rounded-pill bg-primary-subtle text-primary-emphasis expense-index">${String(index + 1).padStart(2, '0')}</span>
      <input class="form-control form-control-ghost fs-5 fw-medium flex-grow-1 expense-title" type="text" value="${safe(expense.title)}" placeholder="Expense name" aria-label="Expense name" data-kind="expense" data-expense="${safe(expense.id)}" data-field="title">
      <div class="input-group input-group-sm expense-price" style="max-width: 9rem"><span class="input-group-text">₹</span><input class="form-control text-end" type="number" min="0" step="0.01" value="${safe(expense.unitPrice)}" placeholder="Price" aria-label="${expense.equalShare ? 'Item total' : 'Unit price'}" data-kind="expense" data-expense="${safe(expense.id)}" data-field="unitPrice"></div>
      <span class="fw-semibold small text-nowrap expense-total" data-total="${safe(expense.id)}">${money(expenseTotal(expense))}</span>
      <div class="form-check form-switch mb-0 text-nowrap expense-equal" title="Split this item equally among families"><input class="form-check-input" type="checkbox" role="switch" id="equal-${safe(expense.id)}" data-kind="expense" data-expense="${safe(expense.id)}" data-field="equalShare" ${expense.equalShare ? 'checked' : ''}><label class="form-check-label small" for="equal-${safe(expense.id)}">Equal</label></div>
      <button class="btn btn-sm btn-outline-secondary expense-collapse"${expense.collapsed ? ' collapsed' : ''} type="button" data-action="toggle-collapse" data-expense="${safe(expense.id)}" aria-controls="expense-allocations-${safe(expense.id)}" aria-label="${expense.collapsed ? 'Expand' : 'Collapse'} item" aria-expanded="${!expense.collapsed}" title="${expense.collapsed ? 'Expand item' : 'Collapse item'}"><svg class="gt-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
      ${removeButton('remove-expense', expense.id)}
    </div>
    <div class="card-body expense-editor">
      <div class="collapse${expense.collapsed ? '' : ' show'}" id="expense-allocations-${safe(expense.id)}">${expense.equalShare ? '' : `
      <div class="row g-2 text-uppercase text-body-secondary small fw-semibold mb-1 expense-grid-heading expense-allocation-heading"><div class="col">Family</div><div class="col-3">Qty</div></div>
      <div>${rows}</div>`}</div>
      <div class="pt-3 mt-3 border-top expense-payment-section">
        <div class="row g-2 text-uppercase text-body-secondary small fw-semibold mb-1 expense-grid-heading expense-payment-heading"><div class="col">Paid by</div><div class="col-4">Contribution</div></div>
        <div>${payments}</div>
        <button class="btn btn-outline-primary btn-sm expense-add-payment" type="button" data-action="add-payment" data-expense="${safe(expense.id)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> Add payer contribution</button>
        <div class="expense-paid-summary"><span>Contributions entered</span><strong data-paid="${safe(expense.id)}">${money(expensePaid(expense))}</strong></div>
      </div>
    </div>
  </article>`;
}

function render() {
  $('#familyCount').text(`${state.people.length} families`);
  $('#familyList').html(state.people.length ? state.people.map(family => {
    const payer = payerForFamily(family.id);
    return `<tr data-family-entry="${safe(family.id)}">
      <td><input class="form-control form-control-sm form-control-ghost fw-medium" type="text" value="${safe(payer?.name || '')}" placeholder="Family head" aria-label="Family head name" data-kind="payer" data-row="${safe(payer?.id || '')}" data-field="name"></td>
      <td class="text-end"><strong data-family-total="${safe(family.id)}">${money(personTotal(family.id))}</strong></td>
      <td class="text-end"><strong data-payer-total="${safe(family.id)}">${money(payer ? payerTotal(payer.id) : 0)}</strong></td>
      <td class="small" data-settlement-family="${safe(family.id)}">—</td>
      <td class="text-center"><button class="btn btn-sm btn-outline-danger" type="button" data-action="remove-family" data-family="${safe(family.id)}" aria-label="Remove ${safe(payer?.name || 'family')}" title="Remove family">${icons.remove}</button></td>
    </tr>`;
    }).join('') : '<tr><td class="text-center text-body-secondary p-4" colspan="5">No families added. Add a family head to get started.</td></tr>');
  $('#expenses').html(state.expenses.length
    ? state.expenses.map(renderExpense).join('')
    : '<div class="text-center text-body-secondary p-5 border rounded-3"><strong class="d-block fs-5 text-body mb-1">No expenses yet</strong>Add the first bill item when you are ready.</div>');
  $('#expenseCount').text(state.expenses.length);
  updateSummary();
}

function updateFamilyNames() {
  const names = new Map(state.people.map(family => [family.id, familyName(family)]));
  $('[data-family-name]').each((_, label) => $(label).text(names.get(label.getAttribute('data-family-name')) || 'Unnamed family'));
  $('select[data-field="personId"] option').each((_, option) => {
    if (names.has(option.value)) $(option).text(names.get(option.value));
  });
}

function settlementPlan() {
  
  // Expenses begin as debts and verified payer contributions are added back to their linked families.
  const balances = new Map(state.people.map(family => [family.id, -toPaise(personTotal(family.id))]));
  const activeFamilies = new Set([...balances].filter(([, balance]) => balance !== 0).map(([familyId]) => familyId));
  let unlinkedPayments = 0;
  state.payers.forEach(payer => {
    const familyId = payerFamilyId(payer);
    state.expenses.forEach(expense => expense.payments.filter(payment => payment.payerId === payer.id).forEach(payment => {
      if (balances.has(familyId)) {
        balances.set(familyId, balances.get(familyId) + toPaise(payment.amount));
        if (toPaise(payment.amount) !== 0) activeFamilies.add(familyId);
      } else unlinkedPayments += toPaise(payment.amount);
    }));
  });
  const debtors = [...balances].filter(([, balance]) => balance < 0).map(([familyId, balance]) => ({ familyId, amount: -balance }));
  const creditors = [...balances].filter(([, balance]) => balance > 0).map(([familyId, balance]) => ({ familyId, amount: balance }));
  const transfers = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  
  // Match the next outstanding debtor and creditor until every balance is settled.
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.amount, creditor.amount);
    transfers.push({ fromFamilyId: debtor.familyId, toFamilyId: creditor.familyId, amount });
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0) debtorIndex++;
    if (creditor.amount === 0) creditorIndex++;
  }
  const unbalanced = debtors.slice(debtorIndex).reduce((sum, entry) => sum + entry.amount, 0) + creditors.slice(creditorIndex).reduce((sum, entry) => sum + entry.amount, 0);
  
  // Hide suggested transfers unless every payment is linked and all paise-level balances net to zero.
  const complete = unlinkedPayments === 0 && unbalanced === 0;
  return { transfers: complete ? transfers : [], unlinkedPayments, unbalanced, activeFamilies, complete };
}

function renderSettlement() {
  const plan = settlementPlan();
  
  // Aggregate transfers by family once, then use the result to render each settlement cell.
  const totals = new Map(state.people.map(family => [family.id, { paid: 0, received: 0, pays: new Set(), receivedFrom: new Set() }]));
  const cells = new Map();
  $('[data-settlement-family]').each((_, cell) => cells.set(cell.getAttribute('data-settlement-family'), $(cell)));
  plan.transfers.forEach(transfer => {
    const payer = totals.get(transfer.fromFamilyId);
    const payee = totals.get(transfer.toFamilyId);
    payer.paid += transfer.amount;
    payer.pays.add(transfer.toFamilyId);
    payee.received += transfer.amount;
    payee.receivedFrom.add(transfer.fromFamilyId);
  });
  totals.forEach((total, familyId) => {
    const $cell = cells.get(familyId);
    if (!$cell) return;
    const isPayer = total.paid > 0;
    const amount = isPayer ? total.paid : total.received;
    const counterparties = isPayer ? total.pays : total.receivedFrom;
    const names = [...counterparties].map(counterpartyId => {
      const family = state.people.find(entry => entry.id === counterpartyId);
      return payerForFamily(counterpartyId)?.name.trim() || family?.name || 'Unnamed family';
    }).join(', ');
    $cell.text(amount
      ? `${isPayer ? 'Pays' : 'Receives'} ${money(amount / 100)} ${isPayer ? 'to' : 'from'} ${names}`
      : (plan.activeFamilies.has(familyId) ? (plan.complete ? 'Settled' : 'Pending') : '—'));
  });
  const $warning = $('#settlementWarning');
  const messages = [];
  if (plan.unlinkedPayments) messages.push(`${money(plan.unlinkedPayments / 100)} in payments need a family link before they can be included.`);
  if (plan.unbalanced) messages.push(`${money(plan.unbalanced / 100)} remains unmatched. Check that all expense shares and payments are entered.`);
  $warning.text(messages.join(' ')).prop('hidden', messages.length === 0);
}

function updateSummary() {
  updateFamilyNames();
  
  // Compute each expense once, then reuse its values for the grand totals and matching DOM elements.
  const expenseValues = new Map(state.expenses.map(expense => [expense.id, {
    total: expenseTotal(expense),
    paid: expensePaid(expense)
  }]));
  const expenses = [...expenseValues.values()].reduce((sum, value) => sum + value.total, 0);
  const paid = [...expenseValues.values()].reduce((sum, value) => sum + value.paid, 0);
  const difference = paid - expenses;
  $('#grandTotal').text(money(expenses));
  $('#paidTotal').text(money(paid));
  $('#difference').text((difference > 0 ? '+' : '') + money(difference));
  renderSettlement();
  $('[data-total]').each((_, element) => {
    const value = expenseValues.get(element.getAttribute('data-total'));
    if (value) $(element).text(money(value.total));
  });
  $('[data-paid]').each((_, element) => {
    const value = expenseValues.get(element.getAttribute('data-paid'));
    if (value) $(element).text(money(value.paid));
  });
  
  // Family shares and payments are separate totals because they represent owed and contributed amounts.
  const familyValues = new Map(state.people.map(family => {
    const payer = payerForFamily(family.id);
    return [family.id, { share: personTotal(family.id), paid: payer ? payerTotal(payer.id) : 0 }];
  }));
  $('[data-family-total]').each((_, element) => {
    const value = familyValues.get(element.getAttribute('data-family-total'));
    if (value) $(element).text(money(value.share));
  });
  $('[data-payer-total]').each((_, element) => {
    const value = familyValues.get(element.getAttribute('data-payer-total'));
    if (value) $(element).text(money(value.paid));
  });
}

function findRecord(target) {
  // Resolve delegated input metadata back to the owning model object instead of storing state on DOM nodes.
  const $target = $(target);
  const kind = $target.attr('data-kind');
  const expenseId = $target.attr('data-expense');
  const rowId = $target.attr('data-row');
  if (kind === 'expense') return state.expenses.find(expense => expense.id === expenseId);
  if (kind === 'person') return state.people.find(person => person.id === rowId);
  if (kind === 'payer') return state.payers.find(payer => payer.id === rowId);
  const expense = state.expenses.find(item => item.id === expenseId);
  if (!expense) return null;
  if (kind === 'payment') return expense.payments.find(row => row.id === rowId);
  return expense.rows.find(row => row.id === rowId) || expense.rows.find(row => row.personId === $target.attr('data-family'));
}

$(document).on('input', '[data-kind][data-field]:not([type="checkbox"])', function () {
  const target = this;
  const record = findRecord(target);
  if (!record) return;
  const field = $(target).attr('data-field');
  record[field] = ['count', 'unitPrice'].includes(field) ? (target.value === '' ? '' : Number(target.value)) : target.value;
  updateSummary();
});
$(document).on('change', 'input[type="checkbox"][data-kind="expense"]', function () {
  const target = this;
  const $target = $(target);
  {
    const expense = state.expenses.find(item => item.id === $target.attr('data-expense'));
    if (expense) {
      expense.equalShare = target.checked;
      expense.collapsed = target.checked;
      
      // Preserve existing quantities and create only missing rows when switching back to manual allocation.
      if (!expense.equalShare) {
        state.people.forEach(family => {
          if (!expense.rows.some(row => row.personId === family.id)) expense.rows.push({ id: id('row'), personId: family.id, count: 0 });
        });
      }
      render();
    }
    return;
  }
});
$(document).on('change', 'select[data-kind][data-field]', function () {
  const target = this;
  const record = findRecord(target);
  if (!record) return;
  record[$(target).attr('data-field')] = target.value;
  updateSummary();
});
$(document).on('click', 'button[data-action]', function () {
  const $button = $(this);
  const action = $button.attr('data-action');
  if (action === 'remove-family') {
    const familyId = $button.attr('data-family');
    const payerIds = state.payers.filter(payer => payerFamilyId(payer) === familyId).map(payer => payer.id);
    state.people = state.people.filter(family => family.id !== familyId);
    state.payers = state.payers.filter(payer => !payerIds.includes(payer.id));
    
    // Remove dependent allocations and payments as well, preventing orphan references in future saves.
    state.expenses.forEach(expense => {
      expense.rows = expense.rows.filter(row => row.personId !== familyId);
      expense.payments = expense.payments.filter(payment => !payerIds.includes(payment.payerId));
    });
    render();
    return;
  }
  const expenseId = $button.attr('data-expense');
  const rowId = $button.attr('data-row');
  const expense = state.expenses.find(item => item.id === expenseId);
  if (!expense) return;
  if (action === 'toggle-collapse') expense.collapsed = !expense.collapsed;
  if (action === 'add-payment') expense.payments.push({ id: id('pay'), payerId: state.payers[0]?.id || '', amount: '' });
  if (action === 'remove-payment') expense.payments = expense.payments.filter(payment => payment.id !== rowId);
  if (action === 'remove-expense') state.expenses = state.expenses.filter(item => item.id !== expense.id);
  render();
});
$('#addExpense').on('click', () => {
  state.expenses.push({ id: id('expense'), title: '', unitPrice: '', equalShare: false, collapsed: false, rows: state.people.map(family => ({ id: id('row'), personId: family.id, count: 0 })), payments: [] });
  render();
  $('#expenses .card:last-child input[data-field="title"]').trigger('focus');
});
$('#addFamily').on('click', () => {
  const familyId = id('family');
  const payerId = id('head');
  state.people.push({ id: familyId, name: `Family ${state.people.length + 1}` });
  state.payers.push({ id: payerId, name: '', familyId });
  state.expenses.forEach(expense => expense.rows.push({ id: id('row'), personId: familyId, count: 0 }));
  render();
  $('#familyList tr:last-child input').trigger('focus');
});
const $shareDialog = $('#shareDialog');
const shareModal = bootstrap.Modal.getOrCreateInstance($shareDialog[0]);
const $shareUrlInput = $('#shareUrl');
const toastInstance = bootstrap.Toast.getOrCreateInstance($('#toast')[0], { delay: 2400 });
const announce = message => {
  $('#toastBody').text(message);
  toastInstance.show();
};

// Serialize bill state into the readable, delimiter-safe URL representation.
const buildShareToken = () => {
  // Family and payer references use their current list positions, keeping the token compact without storing IDs.
  const familyTokens = state.people.map((family, index) => `F${index + 1}-${encodeField(payerForFamily(family.id)?.name || '')}`);
  const expenseTokens = state.expenses.map((expense, index) => {
    const item = `${encodeField(expense.title || `Item ${index + 1}`)}@${Number(expense.unitPrice) || 0}`;
    
    // EQ replaces per-family quantities; otherwise emit a quantity for every family to preserve zero allocations.
    const allocations = expense.equalShare
      ? ['EQ']
      : state.people.map((family, familyIndex) => {
        const row = expense.rows.find(entry => entry.personId === family.id);
        return `F${familyIndex + 1}+${Number(row?.count) || 0}`;
      });
    const contributions = expense.payments.map(payment => {
      const payerIndex = state.payers.findIndex(payer => payer.id === payment.payerId);
      return payerIndex < 0 ? '' : `P${payerIndex + 1}+${Number(payment.amount) || 0}`;
    }).filter(Boolean);
    return [item, ...allocations, ...contributions].join(',');
  });
  return [familyTokens.join(','), ...expenseTokens].join('|');
};
const buildShareUrl = () => `${location.href.split('#')[0]}#data=${buildShareToken()}`;
$('#shareButton').on('click', () => {
  $shareUrlInput.val(buildShareUrl());
  shareModal.show();
  $shareUrlInput.trigger('focus').trigger('select');
});
$('#closeShareDialog').on('click', () => shareModal.hide());
$('#copyShareUrl').on('click', async () => {
  try {
    await navigator.clipboard.writeText($shareUrlInput.val());
    shareModal.hide();
    announce('Share link copied');
  } catch {
    $shareUrlInput.trigger('focus').trigger('select');
    announce('Link selected. Copy it to share.');
  }
});
const $nativeShareButton = $('#nativeShareUrl');
if (!navigator.share) $nativeShareButton.prop('hidden', true);
$nativeShareButton.on('click', async () => {
  try {
    await navigator.share({ title: 'Get Together bill', url: $shareUrlInput.val() });
    shareModal.hide();
  } catch (error) {
    if (error?.name !== 'AbortError') announce('Could not open share sheet');
  }
});
const $confirmDialog = $('#confirmDialog');
const confirmModal = bootstrap.Modal.getOrCreateInstance($confirmDialog[0]);
let confirmResolve = null;
const resolveConfirm = choice => {
  // Modal dismissal and button clicks can race; resolve a pending navigation promise only once.
  if (!confirmResolve) return;
  const resolve = confirmResolve;
  confirmResolve = null;
  confirmModal.hide();
  resolve(choice);
};
const askUnsavedChanges = message => new Promise(resolve => {
  // Keep navigation pending until a modal action or dismissal resolves the user's choice.
  confirmResolve = resolve;
  $('#confirmDialogMessage').text(message);
  confirmModal.show();
});
$('#confirmSave').on('click', () => resolveConfirm('save'));
$('#confirmDiscard').on('click', () => resolveConfirm('discard'));
$('#closeConfirmDialog').on('click', () => resolveConfirm('cancel'));
$confirmDialog.on('hidden.bs.modal', () => resolveConfirm('cancel'));
const openModal = bootstrap.Modal.getOrCreateInstance($('#openDialog')[0]);
const $billList = $('#billList');
const renderBillList = () => {
  const list = loadBillIndex().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  $billList.html(list.length ? list.map(bill => `
    <div class="list-group-item d-flex align-items-center gap-2${bill.id === currentBillId ? ' active' : ''}">
      <button class="btn btn-link text-decoration-none text-start flex-grow-1 p-0${bill.id === currentBillId ? ' text-white' : ''}" type="button" data-action="open-bill" data-bill="${safe(bill.id)}">
        <span class="d-block text-truncate fw-semibold">${safe(bill.name)}</span>
        <span class="d-block small${bill.id === currentBillId ? ' text-white-50' : ' text-body-secondary'}">${safe(new Date(bill.updatedAt).toLocaleString())}</span>
      </button>
      <button class="btn btn-sm btn-outline-danger" type="button" data-action="delete-bill" data-bill="${safe(bill.id)}" aria-label="Delete ${safe(bill.name)}" title="Delete bill">${icons.remove}</button>
    </div>`).join('') : '<p class="text-body-secondary small text-center p-4 mb-0">No saved bills yet.</p>');
};
$('#saveButton').on('click', () => {
  persist();
  announce('Bill saved to this device');
});
$('#newBillButton').on('click', async () => {
  if (hasUnsavedChanges()) {
    const choice = await askUnsavedChanges('You have unsaved changes to this bill. Save them before starting a new bill?');
    if (choice === 'cancel') return;
    if (choice === 'save') persist();
  }
  state = { people: [], payers: [], expenses: [] };
  currentBillId = '';
  localStorage.removeItem(currentBillKey);
  render();
  lastSavedToken = buildShareToken();
  announce('Started a new bill');
});
$('#openButton').on('click', () => {
  renderBillList();
  openModal.show();
});
$('#closeOpenDialog').on('click', () => openModal.hide());
$billList.on('click', '[data-action="open-bill"]', async function () {
    const billId = $(this).attr('data-bill');
    
    // Wait for the user's save/discard choice before replacing the current in-memory bill.
    if (hasUnsavedChanges()) {
      const choice = await askUnsavedChanges('You have unsaved changes to the current bill. Save them before opening the selected bill?');
      if (choice === 'cancel') return;
      if (choice === 'save') persist();
    }
    const loaded = loadStateFromBill(billId);
    if (loaded) {
      state = loaded;
      setCurrentBill(billId);
      lastSavedToken = buildShareToken();
      openModal.hide();
      render();
      announce('Bill loaded');
    } else announce('Could not load this bill');
});
$billList.on('click', '[data-action="delete-bill"]', function () {
    deleteBill($(this).attr('data-bill'));
    renderBillList();
});
$(window).on('hashchange', () => window.location.reload());
$(window).on('beforeunload', event => {
  if (!hasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = '';
});
const initializeState = () => {
  // Shared URL data takes precedence; otherwise restore the last valid bill saved on this device.
  if (shareToken) {
    try {
      const decoded = decodeReadableShare(shareToken);
      if (isBillState(decoded)) {
        state = decoded;
        
        // Save the imported bill locally, then remove its token from the address to avoid re-importing on refresh.
        setCurrentBill(createBill(buildShareToken(), suggestBillName()));
        history.replaceState(null, '', location.pathname + location.search);
        const reloaded = loadStateFromBill(currentBillId);
        if (reloaded) state = reloaded;
        return;
      }
    } catch { /* ignore malformed share token */ }
  }
  const savedBillId = localStorage.getItem(currentBillKey);
  if (savedBillId) {
    const loaded = loadStateFromBill(savedBillId);
    if (loaded) { state = loaded; currentBillId = savedBillId; return; }
  }
};
initializeState();
lastSavedToken = buildShareToken();
render();