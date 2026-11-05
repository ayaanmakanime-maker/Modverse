"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Trash2, Pencil } from "lucide-react";
import { api, errorMessage } from "@/lib/client/api";
import { useSession } from "@/components/session";
import { Badge, Button, ColorPicker, EmptyState, Field, Input, Modal, Notice, Segmented, Select, Spinner, toast } from "@/components/ui";
import { recommendSize } from "@/lib/garment/sizing";
import { createDesign } from "@/lib/garment/design";
import { SKIN_TONES } from "@/lib/three/avatar";
import { passwordStrength } from "@/lib/auth/password-policy";

const GarmentViewer = dynamic(() => import("@/components/three/GarmentViewer").then((m) => m.GarmentViewer), { ssr: false });

function useList<T>(url: string, key: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const reload = useCallback(() => api<Record<string, T[]>>(url).then((r) => setItems(r[key])).catch((e) => toast(errorMessage(e), "bad")), [url, key]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { items, reload };
}

interface Profile { id: string; name: string; audience: "men" | "women" | "kids"; measurements: Record<string, number>; provenance?: Record<string, { source: "user" | "camera" | "derived"; confidence: string; toleranceCm?: number }>; fitPreference: "closer" | "true" | "looser"; childProfileId: string | null }
interface Child { id: string; nickname: string; birthYear: number; allowSharing: boolean; consentVersion: string; consentGivenAt: string }

const FIELDS: [string, string][] = [["height", "Height"], ["chest", "Chest"], ["waist", "Waist"], ["hip", "Hip"], ["shoulder", "Shoulder width"], ["armLength", "Arm length"], ["neck", "Neck"], ["bicep", "Bicep"], ["wrist", "Wrist"]];

export function MeasurementsManager() {
  const { items, reload } = useList<Profile>("/api/account/measurements", "profiles");
  const { items: children } = useList<Child>("/api/account/children", "children");
  const [edit, setEdit] = useState<Partial<Profile> | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      const measurements = Object.fromEntries(Object.entries(edit.measurements ?? {}).filter(([, v]) => v !== undefined && !Number.isNaN(v)));
      const provenance = Object.fromEntries(Object.entries(edit.provenance ?? {}).filter(([k]) => k in measurements));
      const body = { name: edit.name, audience: edit.audience, measurements, provenance, fitPreference: edit.fitPreference ?? "true", childProfileId: edit.childProfileId || null };
      await api(edit.id ? `/api/account/measurements/${edit.id}` : "/api/account/measurements", { method: edit.id ? "PATCH" : "POST", body });
      setEdit(null);
      reload();
      toast("Measurements saved");
    } catch (e) {
      toast(errorMessage(e), "bad");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4" data-testid="measurements">
      <div className="flex items-center justify-between"><h1 className="mv-display text-3xl">Measurements</h1><Button size="sm" onClick={() => setEdit({ audience: "men", measurements: {}, fitPreference: "true" })} data-testid="add-measurements">Add profile</Button></div>
      <Notice tone="info">Measure your body (not a garment) in centimetres. ModVerse compares your measurements with real garment dimensions to recommend sizes — always labelled as an estimate. Values you entered are shown plainly; camera estimates from the trial room are marked with their ± tolerance. Editing a value makes it yours.</Notice>
      {!items ? <Spinner /> : items.length === 0 ? <EmptyState title="No measurement profiles" /> : items.map((p) => {
        const rec = p.measurements.chest ? recommendSize(p.measurements as { chest: number }, createDesign(p.audience === "kids" ? "tee-classic-crew" : "tee-regular", p.audience), p.fitPreference) : null;
        return (
          <div key={p.id} className="mv-card flex flex-wrap items-center justify-between gap-3 p-4">
            <div><p className="font-medium">{p.name} <Badge>{p.audience}</Badge>{p.childProfileId && <Badge tone="info">guardian-managed</Badge>}</p><p className="text-xs text-mute">{Object.entries(p.measurements).map(([k, v]) => { const pv = p.provenance?.[k]; return <span key={k} className="mr-2 inline-block">{k} {v}{pv && pv.source !== "user" && <span className={pv.source === "camera" ? "text-champagne" : "text-warn"} title={pv.source === "camera" ? "Camera estimate" : "Rough estimate"}> ({pv.source === "camera" ? "camera" : "est."}{pv.toleranceCm ? ` ±${pv.toleranceCm}` : ""})</span>}</span>; })}</p></div>
            <div className="flex items-center gap-2">{rec && <span className="text-xs">Regular tee: <b>{rec.size}</b> <span className="text-mute">({rec.confidence}, estimate)</span></span>}<button className="mv-chip" onClick={() => setEdit(p)} aria-label="Edit"><Pencil className="size-3" /></button><button className="mv-chip text-bad" aria-label="Delete" onClick={async () => { if (confirm("Delete this profile?")) { await api(`/api/account/measurements/${p.id}`, { method: "DELETE" }); reload(); } }}><Trash2 className="size-3" /></button></div>
          </div>
        );
      })}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit measurements" : "New measurement profile"}>
        {edit && (
          <div className="space-y-3">
            <Field label="Profile name">{(id) => <Input id={id} value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="mp-name" />}</Field>
            <Segmented label="Category" value={edit.audience ?? "men"} onChange={(a) => setEdit({ ...edit, audience: a })} options={[{ value: "men", label: "Men" }, { value: "women", label: "Women" }, { value: "kids", label: "Kids" }]} />
            {edit.audience === "kids" && (
              <Field label="Child profile (required for children)">{(id) => (
                <Select id={id} value={edit.childProfileId ?? ""} onChange={(e) => setEdit({ ...edit, childProfileId: e.target.value || null })}>
                  <option value="">Select…</option>{(children ?? []).map((c) => <option key={c.id} value={c.id}>{c.nickname}</option>)}
                </Select>
              )}</Field>
            )}
            <div className="grid grid-cols-3 gap-2">
              {FIELDS.map(([k, label]) => (
                <Field key={k} label={`${label} (cm)${edit.provenance?.[k] && edit.provenance[k].source !== "user" ? ` · ${edit.provenance[k].source === "camera" ? "camera est." : "rough est."}` : ""}`}>{(id) => <Input id={id} inputMode="decimal" value={edit.measurements?.[k] ?? ""} onChange={(e) => { const prov = { ...(edit.provenance ?? {}) }; delete prov[k]; setEdit({ ...edit, provenance: prov, measurements: { ...(edit.measurements ?? {}), [k]: e.target.value === "" ? (undefined as unknown as number) : Number(e.target.value) } }); }} data-testid={`mp-${k}`} />}</Field>
              ))}
            </div>
            <Segmented label="Fit preference" value={edit.fitPreference ?? "true"} onChange={(v) => setEdit({ ...edit, fitPreference: v })} options={[{ value: "closer", label: "Closer" }, { value: "true", label: "True to fit" }, { value: "looser", label: "Looser" }]} />
            <Button onClick={save} loading={busy} disabled={!edit.name || !edit.measurements?.chest} data-testid="mp-save">Save</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

interface Avatar { id: string; name: string; measurementProfileId: string | null; appearance: { skinTone: string; build: "slim" | "average" | "athletic" | "broad" | "curvy"; height: number; hair: "short" | "medium" | "long" | "bun" | "none"; pose: "a-pose" | "relaxed"; bodyType: "masculine" | "feminine" | "child" } }

export function AvatarsManager() {
  const { items, reload } = useList<Avatar>("/api/account/avatars", "avatars");
  const { items: profiles } = useList<Profile>("/api/account/measurements", "profiles");
  const [edit, setEdit] = useState<Partial<Avatar> | null>(null);
  const profile = profiles?.find((p) => p.id === edit?.measurementProfileId);
  const preview = createDesign(edit?.appearance?.bodyType === "child" ? "tee-classic-crew" : "tee-regular", edit?.appearance?.bodyType === "feminine" ? "women" : edit?.appearance?.bodyType === "child" ? "kids" : "men");
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="mv-display text-3xl">Avatars</h1><Button size="sm" onClick={() => setEdit({ appearance: { skinTone: SKIN_TONES[3], build: "average", height: 172, hair: "short", pose: "a-pose", bodyType: "masculine" } })}>New avatar</Button></div>
      <Notice tone="info">Avatars are parametric visual representations for previewing garments — not exact physical scans of your body.</Notice>
      {!items ? <Spinner /> : items.length === 0 ? <EmptyState title="No avatars yet" /> : items.map((a) => (
        <div key={a.id} className="mv-card flex items-center justify-between p-4">
          <span className="flex items-center gap-3"><span className="size-8 rounded-full" style={{ background: a.appearance.skinTone }} /><span><span className="block">{a.name}</span><span className="text-xs text-mute">{a.appearance.bodyType} · {a.appearance.build} · {a.appearance.height} cm</span></span></span>
          <span className="flex gap-1"><button className="mv-chip" onClick={() => setEdit(a)}><Pencil className="size-3" /></button><button className="mv-chip text-bad" onClick={async () => { await api(`/api/account/avatars/${a.id}`, { method: "DELETE" }); reload(); }}><Trash2 className="size-3" /></button></span>
        </div>
      ))}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Avatar" wide>
        {edit?.appearance && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <Field label="Name">{(id) => <Input id={id} value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}</Field>
              <Field label="Measurement profile">{(id) => <Select id={id} value={edit.measurementProfileId ?? ""} onChange={(e) => setEdit({ ...edit, measurementProfileId: e.target.value || null })}><option value="">Use size chart</option>{(profiles ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}</Field>
              <Segmented label="Body type" value={edit.appearance.bodyType} onChange={(v) => setEdit({ ...edit, appearance: { ...edit.appearance!, bodyType: v } })} options={[{ value: "masculine", label: "Masculine" }, { value: "feminine", label: "Feminine" }, { value: "child", label: "Child" }]} />
              <Segmented label="Build" value={edit.appearance.build} onChange={(v) => setEdit({ ...edit, appearance: { ...edit.appearance!, build: v } })} options={(["slim", "average", "athletic", "broad", "curvy"] as const).map((b) => ({ value: b, label: b }))} />
              <ColorPicker label="Skin tone" swatches={SKIN_TONES} value={edit.appearance.skinTone} onChange={(c) => setEdit({ ...edit, appearance: { ...edit.appearance!, skinTone: c } })} />
              <Segmented label="Hair" value={edit.appearance.hair} onChange={(v) => setEdit({ ...edit, appearance: { ...edit.appearance!, hair: v } })} options={(["short", "medium", "long", "bun", "none"] as const).map((b) => ({ value: b, label: b }))} />
              <Button onClick={async () => { try { await api(edit.id ? `/api/account/avatars/${edit.id}` : "/api/account/avatars", { method: edit.id ? "PATCH" : "POST", body: { name: edit.name, measurementProfileId: edit.measurementProfileId ?? null, appearance: { ...edit.appearance, height: profile?.measurements.height ?? edit.appearance!.height } } }); setEdit(null); reload(); toast("Avatar saved"); } catch (e) { toast(errorMessage(e), "bad"); } }} disabled={!edit.name}>Save avatar</Button>
            </div>
            <div className="mv-card aspect-square overflow-hidden"><GarmentViewer config={preview} view="front" showAvatar avatar={{ body: profile?.measurements, appearance: { skinTone: edit.appearance.skinTone, build: edit.appearance.build, bodyType: edit.appearance.bodyType, hair: edit.appearance.hair } }} compact /></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function FamilyManager() {
  const { items, reload } = useList<Child>("/api/account/children", "children");
  const [form, setForm] = useState({ nickname: "", birthYear: new Date().getFullYear() - 6, consent: false, allowSharing: false });
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4" data-testid="family">
      <h1 className="mv-display text-3xl">Family (guardian-managed)</h1>
      <Notice tone="info" title="How ModVerse handles children's data">Child profiles are managed only by you, the guardian. We store a nickname and birth year — no full name, date of birth or photos. Children cannot log in, pay or buy independently. Measurements and avatars are private and never shared publicly by default. Deleting a profile deletes its measurements and avatars. (Review applicable Indian privacy and child-data rules, such as the DPDP Act, before production launch.)</Notice>
      {!items ? <Spinner /> : items.map((c) => (
        <div key={c.id} className="mv-card flex items-center justify-between p-4">
          <span><span className="block">{c.nickname}</span><span className="text-xs text-mute">born {c.birthYear} · consent v{c.consentVersion} on {new Date(c.consentGivenAt).toLocaleDateString("en-IN")} · sharing {c.allowSharing ? "on" : "off"}</span></span>
          <button className="mv-chip text-bad" onClick={async () => { if (confirm(`Delete ${c.nickname}'s profile and all their measurements?`)) { await api(`/api/account/children/${c.id}`, { method: "DELETE" }); reload(); } }}><Trash2 className="size-3" /> Delete</button>
        </div>
      ))}
      <form className="mv-card space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await api("/api/account/children", { body: form }); setForm({ ...form, nickname: "", consent: false }); reload(); toast("Child profile created"); } catch (err) { toast(errorMessage(err), "bad"); } finally { setBusy(false); } }}>
        <p className="font-medium">Add a child profile</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nickname">{(id) => <Input id={id} value={form.nickname} maxLength={30} onChange={(e) => setForm({ ...form, nickname: e.target.value })} data-testid="child-nickname" />}</Field>
          <Field label="Birth year">{(id) => <Input id={id} type="number" value={form.birthYear} min={new Date().getFullYear() - 15} max={new Date().getFullYear()} onChange={(e) => setForm({ ...form, birthYear: Number(e.target.value) })} />}</Field>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} data-testid="child-consent" /> I am this child&apos;s parent or legal guardian and consent to ModVerse storing their nickname, birth year and measurements for sizing.</label>
        <label className="flex items-start gap-2 text-sm text-mute"><input type="checkbox" className="mt-1" checked={form.allowSharing} onChange={(e) => setForm({ ...form, allowSharing: e.target.checked })} /> Allow sharing this child&apos;s designs (off by default).</label>
        <Button type="submit" loading={busy} disabled={!form.consent || !form.nickname} data-testid="child-save">Create profile</Button>
      </form>
    </div>
  );
}

interface Address { id: string; label: string; fullName: string; phone: string; line1: string; line2: string | null; city: string; state: string; pincode: string; isDefault: boolean }
export const EMPTY_ADDRESS = { label: "Home", fullName: "", phone: "", line1: "", line2: "", city: "", state: "", pincode: "", isDefault: false };

export function AddressForm({ value, onChange }: { value: typeof EMPTY_ADDRESS; onChange: (v: typeof EMPTY_ADDRESS) => void }) {
  const f = (k: keyof typeof EMPTY_ADDRESS, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => <Field label={label}>{(id) => <Input id={id} value={String(value[k] ?? "")} onChange={(e) => onChange({ ...value, [k]: e.target.value })} data-testid={`addr-${k}`} {...extra} />}</Field>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {f("fullName", "Full name", { autoComplete: "name" })}{f("phone", "Mobile (+91)", { autoComplete: "tel", inputMode: "tel" })}
      <div className="col-span-2">{f("line1", "Address line 1", { autoComplete: "address-line1" })}</div>
      <div className="col-span-2">{f("line2", "Address line 2 (optional)", { autoComplete: "address-line2" })}</div>
      {f("city", "City", { autoComplete: "address-level2" })}{f("state", "State", { autoComplete: "address-level1" })}{f("pincode", "PIN code", { autoComplete: "postal-code", inputMode: "numeric" })}{f("label", "Label")}
    </div>
  );
}

export function AddressesManager() {
  const { items, reload } = useList<Address>("/api/account/addresses", "addresses");
  const [form, setForm] = useState(EMPTY_ADDRESS);
  return (
    <div className="space-y-4">
      <h1 className="mv-display text-3xl">Addresses</h1>
      {items?.map((a) => (
        <div key={a.id} className="mv-card flex items-center justify-between p-4 text-sm">
          <span><span className="block">{a.label} {a.isDefault && <Badge tone="ok">default</Badge>}</span><span className="text-mute">{a.fullName} · {a.phone} · {a.line1}, {a.city}, {a.state} {a.pincode}</span></span>
          <button className="mv-chip text-bad" onClick={async () => { await api(`/api/account/addresses/${a.id}`, { method: "DELETE" }); reload(); }}><Trash2 className="size-3" /></button>
        </div>
      ))}
      <form className="mv-card space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); try { await api("/api/account/addresses", { body: { ...form, line2: form.line2 || null } }); setForm(EMPTY_ADDRESS); reload(); toast("Address saved"); } catch (err) { toast(errorMessage(err), "bad"); } }}>
        <p className="font-medium">Add address</p>
        <AddressForm value={form} onChange={setForm} />
        <Button type="submit">Save address</Button>
      </form>
    </div>
  );
}

export function SettingsPanel() {
  const router = useRouter();
  const { setUser } = useSession();
  const [profile, setProfile] = useState<{ name: string; phone: string | null; marketingOptIn: boolean; email: string } | null>(null);
  const [sessions, setSessions] = useState<{ id: string; current: boolean; userAgent: string | null; lastSeenAt: string }[]>([]);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [del, setDel] = useState({ password: "", confirm: "" });
  useEffect(() => {
    api<{ profile: typeof profile }>("/api/account").then((r) => setProfile(r.profile));
    api<{ sessions: typeof sessions }>("/api/auth/sessions").then((r) => setSessions(r.sessions));
  }, []);
  if (!profile) return <Spinner />;
  return (
    <div className="space-y-6">
      <h1 className="mv-display text-3xl">Settings</h1>
      <form className="mv-card space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); try { await api("/api/account", { method: "PATCH", body: { name: profile.name, phone: profile.phone || null, marketingOptIn: profile.marketingOptIn } }); toast("Profile updated"); router.refresh(); } catch (err) { toast(errorMessage(err), "bad"); } }}>
        <p className="font-medium">Profile</p>
        <p className="text-sm text-mute">{profile.email}</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name">{(id) => <Input id={id} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />}</Field>
          <Field label="Mobile">{(id) => <Input id={id} value={profile.phone ?? ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={profile.marketingOptIn} onChange={(e) => setProfile({ ...profile, marketingOptIn: e.target.checked })} /> Design inspiration emails</label>
        <Button type="submit" size="sm">Save profile</Button>
      </form>
      <form className="mv-card space-y-3 p-4" onSubmit={async (e) => { e.preventDefault(); try { await api("/api/account/password", { body: pw }); setPw({ currentPassword: "", newPassword: "" }); toast("Password changed — other sessions were signed out"); } catch (err) { toast(errorMessage(err), "bad"); } }}>
        <p className="font-medium">Change password</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Current password">{(id) => <Input id={id} type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" />}</Field>
          <Field label="New password" hint={pw.newPassword ? passwordStrength(pw.newPassword).label : undefined}>{(id) => <Input id={id} type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" />}</Field>
        </div>
        <Button type="submit" size="sm">Update password</Button>
      </form>
      <div className="mv-card space-y-2 p-4">
        <p className="font-medium">Active sessions</p>
        {sessions.map((s) => <p key={s.id} className="text-xs text-mute">{s.current ? "This device · " : ""}{s.userAgent?.slice(0, 80) ?? "Unknown device"} · last seen {new Date(s.lastSeenAt).toLocaleString("en-IN")}</p>)}
        <Button size="sm" variant="ghost" onClick={async () => { await api("/api/auth/sessions", { method: "DELETE" }); setSessions(sessions.filter((s) => s.current)); toast("Signed out of other devices"); }}>Sign out other devices</Button>
      </div>
      <form className="mv-card space-y-3 border-bad/30 p-4" onSubmit={async (e) => { e.preventDefault(); try { await api("/api/account", { method: "DELETE", body: del }); setUser(null); router.push("/"); router.refresh(); } catch (err) { toast(errorMessage(err), "bad"); } }}>
        <p className="font-medium text-bad">Delete account</p>
        <p className="text-xs text-mute">Deletes your profile, addresses, measurements, avatars, child profiles, uploads and designs. Order records are kept for legal/accounting purposes but detached from your identity.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Password">{(id) => <Input id={id} type="password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} />}</Field>
          <Field label='Type "DELETE"'>{(id) => <Input id={id} value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} />}</Field>
        </div>
        <Button type="submit" variant="danger" size="sm" disabled={del.confirm !== "DELETE" || !del.password}>Delete my account</Button>
      </form>
    </div>
  );
}
