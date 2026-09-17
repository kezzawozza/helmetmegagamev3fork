"use client";

import { useState, useTransition } from "react";
import { useRefresh } from "./useRefresh";
import { depotBank, depotCredit, depotOpenAccount } from "@/app/(app)/depot/actions";
import RequestDialog from "./RequestDialog";

// Your account, and the door between a claim and a coin.
//
// The class is the thing to read first. A Treasury account is backed by real
// coin in the Keep's Vault: withdrawing takes it out, depositing puts it back,
// and an empty Vault means nobody gets paid however healthy their balance
// looks. An Offshore account — the Merchant's and his Dockers' — is money the
// Company holds off-world, so none of that applies to it.
export default function DepotAtmsTab({
  account,
  heldObols,
  vaultObols,
  depot,
  creditAvailable,
  licensed,
  disabled,
  ledger = [],
}) {
  const [refresh] = useRefresh();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState(null); // { kind, direction, max }
  const [amount, setAmount] = useState(1);
  const [error, setError] = useState(null);

  function ask(kind, direction, max) {
    setDialog({ kind, direction, max });
    setAmount(Math.min(1, max) || 1);
    setError(null);
  }

  function submit(reason) {
    const n = Math.max(1, Math.min(Number(amount) || 0, dialog.max));
    startTransition(async () => {
      const result = await (dialog.kind === "bank" ? depotBank : depotCredit)({
        direction: dialog.direction,
        amount: n,
        reason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDialog(null);
      refresh();
    });
  }

  function open() {
    startTransition(async () => {
      const result = await depotOpenAccount();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      refresh();
    });
  }

  if (!account) {
    return (
      <section className="panel p-5">
        <h2 className="panel-header">No account</h2>
        <p className="mt-3 text-sm text-muted">
          Nothing here is yours yet. Opening one takes a moment and costs nothing.
        </p>
        <button type="button" className="btn mt-4" disabled={disabled || pending} onClick={open}>
          Create an account
        </button>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>
    );
  }

  const balance = account.balanceObols ?? 0;
  const debt = depot.debtObols ?? 0;
  const cap = depot.creditCapObols ?? 0;
  const pct = cap > 0 ? Math.min(100, Math.round((debt / cap) * 100)) : 0;
  // The Vault is the real ceiling on a withdrawal, not the balance.
  const withdrawMax = account.backed ? Math.min(balance, vaultObols) : balance;

  return (
    <div className="depot-split">
      <section className="panel p-5">
        <h2 className="panel-header">{account.backed ? "Treasury account" : "Offshore account"}</h2>

        <dl className="depot-totals">
          <div>
            <dt>Account</dt>
            <dd className="mono">{balance} ¢</dd>
          </div>
          <div>
            <dt>Fingerprint</dt>
            <dd className="mono">{account.fingerprint}</dd>
          </div>
          <div>
            <dt>In your pocket</dt>
            <dd className="mono">{heldObols} ¢</dd>
          </div>
          {account.backed && (
            <div className={vaultObols < balance ? "text-danger" : undefined}>
              <dt>In the Vault</dt>
              <dd className="mono">{vaultObols} ¢</dd>
            </div>
          )}
        </dl>

        <p className="mt-3 text-sm text-muted">
          {account.backed
            ? "Your coin sits in the Keep's Vault. You can only draw out what is actually in there."
            : "The Company holds this off-world. There is no vault behind it."}
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="btn"
            disabled={disabled || pending || !withdrawMax}
            onClick={() => ask("bank", "WITHDRAW", withdrawMax)}
          >
            Withdraw
          </button>
          <button
            type="button"
            className="btn-quiet"
            disabled={disabled || pending || !heldObols}
            onClick={() => ask("bank", "DEPOSIT", heldObols)}
          >
            Deposit
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      <section className="panel p-5 depot-aside">
        {licensed && (
          <>
            <h2 className="panel-header">The Company&apos;s line</h2>
            <dl className="depot-totals">
              <div>
                <dt>Owed</dt>
                <dd className="mono">{debt} ¢</dd>
              </div>
              <div>
                <dt>Left on it</dt>
                <dd className="mono">{creditAvailable} ¢</dd>
              </div>
            </dl>
            <div className="depot-meter" role="img" aria-label={`${debt} of ${cap} drawn`}>
              <span className="depot-meter-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="btn"
                disabled={disabled || pending || !creditAvailable}
                onClick={() => ask("credit", "DRAW", creditAvailable)}
              >
                Draw
              </button>
              <button
                type="button"
                className="btn-quiet"
                disabled={disabled || pending || !debt || !balance}
                onClick={() => ask("credit", "REPAY", Math.min(debt, balance))}
              >
                Repay
              </button>
            </div>
          </>
        )}

        <h2 className={licensed ? "panel-header mt-6" : "panel-header"}>Your transactions</h2>
        {ledger.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="depot-list mt-3">
            {ledger.slice(0, 20).map((row) => (
              <li key={row.id}>
                <span>
                  {row.label}
                  {row.detail ? ` — ${row.detail}` : ""}
                </span>
                <span className="mono">{row.delta ? `${row.delta > 0 ? "+" : ""}${row.delta} ¢` : "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog && (
        <RequestDialog
          open
          title={
            dialog.kind === "bank"
              ? dialog.direction === "WITHDRAW"
                ? "Withdraw"
                : "Deposit"
              : dialog.direction === "DRAW"
                ? "Draw on the line"
                : "Repay the line"
          }
          submitLabel="Do it"
          busy={pending}
          error={error}
          onCancel={() => setDialog(null)}
          onConfirm={submit}
        >
          <label className="field">
            <span>Amount</span>
            <input
              type="number"
              min={1}
              max={dialog.max}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <p className="text-sm text-muted">At most {dialog.max} ¢.</p>
        </RequestDialog>
      )}
    </div>
  );
}
