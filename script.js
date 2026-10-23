    (() => {
      const billIndexKey = 'gathering-bills-index';
      const currentBillKey = 'gathering-current-bill';
      const billDataKey = billId => `gathering-bill-data-${billId}`;
      const icons = {
        remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 13h12l1-13M9 7V4h6v3"/></svg>'
      };
      const decodeField = value => decodeURIComponent(value || '');
      const encodeField = value => encodeURIComponent(String(value ?? '')).replace(/[!'()*@,|~+;=]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
      const isBillState = value => value && Array.isArray(value.people) && Array.isArray(value.payers) && Array.isArray(value.expenses) && value.expenses.every(expense => Array.isArray(expense.rows) && Array.isArray(expense.payments));
      const shareToken = location.hash.startsWith('#data=') ? location.hash.slice(6) : '';
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
      let state = { people: [], payers: [], expenses: [] };

      const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(Number(value) || 0);
      const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      const id = prefix => prefix + '-' + Math.random().toString(36).slice(2, 10);
      const rowTotal = (expense, row) => (Number(row.count) || 0) * (Number(expense.unitPrice) || 0);
      const expenseTotal = expense => expense.equalShare ? Number(expense.unitPrice) || 0 : expense.rows.reduce((sum, row) => sum + rowTotal(expense, row), 0);
      const expensePaid = expense => expense.payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
      const expensePersonTotal = (expense, personId) => {
        if (!expense.equalShare) return expense.rows.filter(row => row.personId === personId).reduce((sum, row) => sum + rowTotal(expense, row), 0);
        const familyIndex = state.people.findIndex(family => family.id === personId);
        if (familyIndex < 0 || !state.people.length) return 0;
        const totalPaise = Math.round((Number(expense.unitPrice) || 0) * 100);
        return (Math.floor(totalPaise / state.people.length) + (familyIndex < totalPaise % state.people.length ? 1 : 0)) / 100;
      };
      const personTotal = personId => state.expenses.reduce((sum, expense) => sum + expensePersonTotal(expense, personId), 0);
      const payerTotal = payerId => state.expenses.reduce((sum, expense) => sum + expense.payments.filter(payment => payment.payerId === payerId).reduce((subtotal, row) => subtotal + (Number(row.amount) || 0), 0), 0);
      const toPaise = amount => Math.round((Number(amount) || 0) * 100);
      const payerFamilyId = payer => state.people.some(family => family.id === payer.familyId) ? payer.familyId : '';
      const payerForFamily = familyId => state.payers.find(payer => payerFamilyId(payer) === familyId);
      const familyName = family => {
        const headName = payerForFamily(family.id)?.name.trim();
        return headName ? `${headName}'s family` : family.name || 'Unnamed family';
      };
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
        lastSavedToken = token;
      };
      const hasUnsavedChanges = () => buildShareToken() !== lastSavedToken;
      const options = (list, selectedId, emptyLabel, labelFor = entry => entry.name) => {
        const placeholder = `<option value="">${safe(emptyLabel)}</option>`;
        return placeholder + list.map(entry => `<option value="${safe(entry.id)}" ${entry.id === selectedId ? 'selected' : ''}>${safe(labelFor(entry) || 'Unnamed')}</option>`).join('');
      };
      const removeButton = (type, expenseId, rowId) => {
        const label = type === 'remove-expense' ? 'Delete item' : type === 'remove-payment' ? 'Remove contribution' : 'Remove row';
        return `<button class="icon-button" type="button" data-action="${type}" data-expense="${safe(expenseId)}" data-row="${safe(rowId || '')}" aria-label="${label}" title="${label}">${icons.remove}</button>`;
      };

      function renderExpense(expense, index) {
        const rows = expense.equalShare ? '' : state.people.map(family => {
          const row = expense.rows.find(entry => entry.personId === family.id) || { id: `allocation-${expense.id}-${family.id}`, personId: family.id, count: 0 };
          return `
          <div class="subrow">
            <span data-family-name="${safe(family.id)}">${safe(familyName(family))}</span>
            <input type="number" min="0" step="1" value="${safe(row.count ?? 0)}" placeholder="0" aria-label="${safe(familyName(family))} quantity" data-kind="row" data-expense="${safe(expense.id)}" data-row="${safe(row.id)}" data-family="${safe(family.id)}" data-field="count">
          </div>`;
        }).join('');
        const payments = expense.payments.map(payment => `
          <div class="paid-row">
            <select aria-label="Family head" data-kind="payment" data-expense="${safe(expense.id)}" data-row="${safe(payment.id)}" data-field="payerId">${options(state.payers, payment.payerId, 'Choose family head')}</select>
            <div class="amount-wrap"><input class="amount" type="number" min="0" step="0.01" value="${safe(payment.amount)}" placeholder="0.00" aria-label="Contribution amount" data-kind="payment" data-expense="${safe(expense.id)}" data-row="${safe(payment.id)}" data-field="amount"></div>
            ${removeButton('remove-payment', expense.id, payment.id)}
          </div>`).join('');
        return `<article class="expense${expense.collapsed ? ' is-collapsed' : ''}" data-expense-card="${safe(expense.id)}">
          <div class="expense-head"><span class="expense-index">${String(index + 1).padStart(2, '0')}</span>
            <input class="expense-title" type="text" value="${safe(expense.title)}" placeholder="Expense name" aria-label="Expense name" data-kind="expense" data-expense="${safe(expense.id)}" data-field="title">
            <div class="amount-wrap expense-price"><input class="amount" type="number" min="0" step="0.01" value="${safe(expense.unitPrice)}" placeholder="Price" aria-label="${expense.equalShare ? 'Item total' : 'Unit price'}" data-kind="expense" data-expense="${safe(expense.id)}" data-field="unitPrice"></div>
            <span class="expense-total" data-total="${safe(expense.id)}">${money(expenseTotal(expense))}</span>
            <label class="equal-share" title="Split this item equally among families"><input type="checkbox" data-kind="expense" data-expense="${safe(expense.id)}" data-field="equalShare" ${expense.equalShare ? 'checked' : ''}> Equal</label>
            <button class="icon-button collapse-button" type="button" data-action="toggle-collapse" data-expense="${safe(expense.id)}" aria-controls="expense-allocations-${safe(expense.id)}" aria-label="${expense.collapsed ? 'Expand' : 'Collapse'} item" aria-expanded="${!expense.collapsed}" title="${expense.collapsed ? 'Expand item' : 'Collapse item'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
            ${removeButton('remove-expense', expense.id)}
          </div>
          <div class="expense-body">
            <div class="expense-allocations" id="expense-allocations-${safe(expense.id)}">${expense.equalShare ? '' : `
            <div class="subhead"><span>Family quantities</span></div>
            <div class="subhead rows-heading"><span>Family</span><span>Qty</span></div>
            <div class="rows">${rows}</div>`}</div>
            <div class="paid-block"><div class="subhead"><span>Paid by</span><span>Contribution</span></div>
              <div class="payments">${payments}</div>
              <button class="add-line" type="button" data-action="add-payment" data-expense="${safe(expense.id)}">+ Add payer contribution</button>
              <div class="payer-total">Contributions entered: <strong data-paid="${safe(expense.id)}">${money(expensePaid(expense))}</strong></div>
            </div>
          </div>
        </article>`;
      }

      function render() {
        document.getElementById('familyCount').textContent = `${state.people.length} families`;
        document.getElementById('familyList').innerHTML = state.people.length ? state.people.map(family => {
          const payer = payerForFamily(family.id);
          return `<tr data-family-entry="${safe(family.id)}">
            <td><input class="family-head-input" type="text" value="${safe(payer?.name || '')}" placeholder="Family head" aria-label="Family head name" data-kind="payer" data-row="${safe(payer?.id || '')}" data-field="name"></td>
            <td class="number"><strong data-family-total="${safe(family.id)}">${money(personTotal(family.id))}</strong></td>
            <td class="number"><strong data-payer-total="${safe(family.id)}">${money(payer ? payerTotal(payer.id) : 0)}</strong></td>
            <td class="settlement-value" data-settlement-family="${safe(family.id)}">—</td>
            <td class="family-action"><button class="icon-button" type="button" data-action="remove-family" data-family="${safe(family.id)}" aria-label="Remove ${safe(payer?.name || 'family')}" title="Remove family">${icons.remove}</button></td>
          </tr>`;
          }).join('') : '<tr><td class="empty-state" colspan="5">No families added. Add a family head to get started.</td></tr>';
        document.getElementById('expenses').innerHTML = state.expenses.length
          ? state.expenses.map(renderExpense).join('')
          : '<div class="empty-state"><strong>No expenses yet</strong>Add the first bill item when you are ready.</div>';
        document.getElementById('expenseCount').textContent = state.expenses.length;
        updateSummary();
      }

      function updateFamilyNames() {
        state.people.forEach(family => {
          document.querySelectorAll(`[data-family-name="${CSS.escape(family.id)}"]`).forEach(label => {
            label.textContent = familyName(family);
          });
          document.querySelectorAll(`select[data-field="personId"] option[value="${CSS.escape(family.id)}"]`).forEach(option => {
            option.textContent = familyName(family);
          });
        });
      }

      function settlementPlan() {
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
        return { transfers, unlinkedPayments, unbalanced, activeFamilies };
      }

      function renderSettlement() {
        const plan = settlementPlan();
        const totals = new Map(state.people.map(family => [family.id, { paid: 0, received: 0, pays: new Set(), receivedFrom: new Set() }]));
        plan.transfers.forEach(transfer => {
          const payer = totals.get(transfer.fromFamilyId);
          const payee = totals.get(transfer.toFamilyId);
          payer.paid += transfer.amount;
          payer.pays.add(transfer.toFamilyId);
          payee.received += transfer.amount;
          payee.receivedFrom.add(transfer.fromFamilyId);
        });
        totals.forEach((total, familyId) => {
          const cell = document.querySelector(`[data-settlement-family="${CSS.escape(familyId)}"]`);
          if (!cell) return;
          const isPayer = total.paid > 0;
          const amount = isPayer ? total.paid : total.received;
          const counterparties = isPayer ? total.pays : total.receivedFrom;
          const names = [...counterparties].map(counterpartyId => {
            const family = state.people.find(entry => entry.id === counterpartyId);
            return payerForFamily(counterpartyId)?.name.trim() || family?.name || 'Unnamed family';
          }).join(', ');
          cell.textContent = amount
            ? `${isPayer ? 'Pays' : 'Receives'} ${money(amount / 100)} ${isPayer ? 'to' : 'from'} ${names}`
            : (plan.activeFamilies.has(familyId) ? 'Settled' : '—');
        });
        const warning = document.getElementById('settlementWarning');
        const messages = [];
        if (plan.unlinkedPayments) messages.push(`${money(plan.unlinkedPayments / 100)} in payments need a family link before they can be included.`);
        if (plan.unbalanced) messages.push(`${money(plan.unbalanced / 100)} remains unmatched. Check that all expense shares and payments are entered.`);
        warning.textContent = messages.join(' ');
        warning.hidden = messages.length === 0;
      }

      function updateSummary() {
        updateFamilyNames();
        const expenses = state.expenses.reduce((sum, expense) => sum + expenseTotal(expense), 0);
        const paid = state.expenses.reduce((sum, expense) => sum + expensePaid(expense), 0);
        const difference = paid - expenses;
        document.getElementById('grandTotal').textContent = money(expenses);
        document.getElementById('paidTotal').textContent = money(paid);
        document.getElementById('difference').textContent = (difference > 0 ? '+' : '') + money(difference);
        renderSettlement();
        state.expenses.forEach(expense => {
          const total = document.querySelector(`[data-total="${CSS.escape(expense.id)}"]`);
          const paidElement = document.querySelector(`[data-paid="${CSS.escape(expense.id)}"]`);
          if (total) total.textContent = money(expenseTotal(expense));
          if (paidElement) paidElement.textContent = money(expensePaid(expense));
        });
        state.people.forEach(family => {
          const share = document.querySelector(`[data-family-total="${CSS.escape(family.id)}"]`);
          const paid = document.querySelector(`[data-payer-total="${CSS.escape(family.id)}"]`);
          const payer = payerForFamily(family.id);
          if (share) share.textContent = money(personTotal(family.id));
          if (paid) paid.textContent = money(payer ? payerTotal(payer.id) : 0);
        });
      }

      function findRecord(target) {
        if (target.dataset.kind === 'expense') return state.expenses.find(expense => expense.id === target.dataset.expense);
        if (target.dataset.kind === 'person') return state.people.find(person => person.id === target.dataset.row);
        if (target.dataset.kind === 'payer') return state.payers.find(payer => payer.id === target.dataset.row);
        const expense = state.expenses.find(item => item.id === target.dataset.expense);
        if (!expense) return null;
        if (target.dataset.kind === 'payment') return expense.payments.find(row => row.id === target.dataset.row);
        return expense.rows.find(row => row.id === target.dataset.row) || expense.rows.find(row => row.personId === target.dataset.family);
      }

      document.addEventListener('input', event => {
        const target = event.target;
        if (!target.matches('[data-kind][data-field]')) return;
        if (target.type === 'checkbox') return;
        const record = findRecord(target);
        if (!record) return;
        record[target.dataset.field] = ['count', 'unitPrice'].includes(target.dataset.field) ? (target.value === '' ? '' : Number(target.value)) : target.value;
        updateSummary();
      });
      document.addEventListener('change', event => {
        const target = event.target;
        if (target.matches('input[type="checkbox"][data-kind="expense"]')) {
          const expense = state.expenses.find(item => item.id === target.dataset.expense);
          if (expense) { expense.equalShare = target.checked; expense.collapsed = target.checked; render(); }
          return;
        }
        if (!target.matches('select[data-kind][data-field]')) return;
        const record = findRecord(target);
        if (!record) return;
        record[target.dataset.field] = target.value;
        updateSummary();
      });
      document.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        if (button.dataset.action === 'remove-family') {
          const familyId = button.dataset.family;
          const payerIds = state.payers.filter(payer => payerFamilyId(payer) === familyId).map(payer => payer.id);
          state.people = state.people.filter(family => family.id !== familyId);
          state.payers = state.payers.filter(payer => !payerIds.includes(payer.id));
          state.expenses.forEach(expense => {
            expense.rows = expense.rows.filter(row => row.personId !== familyId);
            expense.payments = expense.payments.filter(payment => !payerIds.includes(payment.payerId));
          });
          render();
          return;
        }
        const expense = state.expenses.find(item => item.id === button.dataset.expense);
        if (!expense) return;
        if (button.dataset.action === 'toggle-collapse') expense.collapsed = !expense.collapsed;
        if (button.dataset.action === 'add-payment') expense.payments.push({ id: id('pay'), payerId: state.payers[0]?.id || '', amount: '' });
        if (button.dataset.action === 'remove-payment') expense.payments = expense.payments.filter(payment => payment.id !== button.dataset.row);
        if (button.dataset.action === 'remove-expense') state.expenses = state.expenses.filter(item => item.id !== expense.id);
        render();
      });
      document.getElementById('addExpense').addEventListener('click', () => {
        state.expenses.push({ id: id('expense'), title: '', unitPrice: '', equalShare: false, collapsed: false, rows: state.people.map(family => ({ id: id('row'), personId: family.id, count: 0 })), payments: [] });
        render();
        document.querySelector('.expense:last-child .expense-title')?.focus();
      });
      document.getElementById('addFamily').addEventListener('click', () => {
        const familyId = id('family');
        const payerId = id('head');
        state.people.push({ id: familyId, name: `Family ${state.people.length + 1}` });
        state.payers.push({ id: payerId, name: '', familyId });
        state.expenses.forEach(expense => expense.rows.push({ id: id('row'), personId: familyId, count: 0 }));
        render();
        document.querySelector('#familyList tr:last-child input')?.focus();
      });
      const shareDialog = document.getElementById('shareDialog');
      const shareUrlInput = document.getElementById('shareUrl');
      const toast = document.getElementById('toast');
      let toastTimer;
      const announce = message => {
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
      };
      const buildShareToken = () => {
        const familyTokens = state.people.map((family, index) => `F${index + 1}-${encodeField(payerForFamily(family.id)?.name || '')}`);
        const expenseTokens = state.expenses.map((expense, index) => {
          const item = `${encodeField(expense.title || `Item ${index + 1}`)}@${Number(expense.unitPrice) || 0}`;
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
      document.getElementById('shareButton').addEventListener('click', () => {
        shareUrlInput.value = buildShareUrl();
        shareDialog.showModal();
        shareUrlInput.focus();
        shareUrlInput.select();
      });
      document.getElementById('closeShareDialog').addEventListener('click', () => shareDialog.close());
      document.getElementById('copyShareUrl').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(shareUrlInput.value);
          shareDialog.close();
          announce('Share link copied');
        } catch {
          shareUrlInput.focus();
          shareUrlInput.select();
          announce('Link selected. Copy it to share.');
        }
      });
      const nativeShareButton = document.getElementById('nativeShareUrl');
      if (!navigator.share) nativeShareButton.hidden = true;
      nativeShareButton.addEventListener('click', async () => {
        try {
          await navigator.share({ title: 'Get Together bill', url: shareUrlInput.value });
          shareDialog.close();
        } catch (error) {
          if (error?.name !== 'AbortError') announce('Could not open share sheet');
        }
      });
      const confirmDialog = document.getElementById('confirmDialog');
      const confirmDialogMessage = document.getElementById('confirmDialogMessage');
      let confirmResolve = null;
      const resolveConfirm = choice => {
        if (!confirmResolve) return;
        const resolve = confirmResolve;
        confirmResolve = null;
        confirmDialog.close();
        resolve(choice);
      };
      const askUnsavedChanges = message => new Promise(resolve => {
        confirmResolve = resolve;
        confirmDialogMessage.textContent = message;
        confirmDialog.showModal();
      });
      document.getElementById('confirmSave').addEventListener('click', () => resolveConfirm('save'));
      document.getElementById('confirmDiscard').addEventListener('click', () => resolveConfirm('discard'));
      document.getElementById('closeConfirmDialog').addEventListener('click', () => resolveConfirm('cancel'));
      confirmDialog.addEventListener('cancel', () => resolveConfirm('cancel'));
      const openDialog = document.getElementById('openDialog');
      const billListElement = document.getElementById('billList');
      const renderBillList = () => {
        const list = loadBillIndex().slice().sort((a, b) => b.updatedAt - a.updatedAt);
        billListElement.innerHTML = list.length ? list.map(bill => `
          <div class="bill-item${bill.id === currentBillId ? ' is-current' : ''}">
            <button class="bill-item-info" type="button" data-action="open-bill" data-bill="${safe(bill.id)}">
              <span class="bill-item-name">${safe(bill.name)}</span>
              <span class="bill-item-meta">${safe(new Date(bill.updatedAt).toLocaleString())}</span>
            </button>
            <button class="icon-button" type="button" data-action="delete-bill" data-bill="${safe(bill.id)}" aria-label="Delete ${safe(bill.name)}" title="Delete bill">${icons.remove}</button>
          </div>`).join('') : '<p class="bill-list-empty">No saved bills yet.</p>';
      };
      document.getElementById('saveButton').addEventListener('click', () => {
        persist();
        announce('Bill saved to this device');
      });
      document.getElementById('newBillButton').addEventListener('click', async () => {
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
      document.getElementById('openButton').addEventListener('click', () => {
        renderBillList();
        openDialog.showModal();
      });
      document.getElementById('closeOpenDialog').addEventListener('click', () => openDialog.close());
      billListElement.addEventListener('click', async event => {
        const openItem = event.target.closest('[data-action="open-bill"]');
        const deleteItem = event.target.closest('[data-action="delete-bill"]');
        if (openItem) {
          if (hasUnsavedChanges()) {
            const choice = await askUnsavedChanges('You have unsaved changes to the current bill. Save them before opening the selected bill?');
            if (choice === 'cancel') return;
            if (choice === 'save') persist();
          }
          const loaded = loadStateFromBill(openItem.dataset.bill);
          if (loaded) {
            state = loaded;
            setCurrentBill(openItem.dataset.bill);
            lastSavedToken = buildShareToken();
            openDialog.close();
            render();
            announce('Bill loaded');
          } else announce('Could not load this bill');
          return;
        }
        if (deleteItem) {
          deleteBill(deleteItem.dataset.bill);
          renderBillList();
        }
      });
      window.addEventListener('hashchange', () => window.location.reload());
      window.addEventListener('beforeunload', event => {
        if (!hasUnsavedChanges()) return;
        event.preventDefault();
        event.returnValue = '';
      });
      const initializeState = () => {
        if (shareToken) {
          try {
            const decoded = decodeReadableShare(shareToken);
            if (isBillState(decoded)) {
              state = decoded;
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
    })();
