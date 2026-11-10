import { makeT } from "app/client/lib/localization";
import { basicButton } from "app/client/ui2018/buttons";
import { ReferenceFilter } from "app/common/ReferenceTables";

import { Disposable, dom, input, obsArray, Observable, styled } from "grainjs";

const t = makeT("ReferenceFilterEditor");
interface Column { id: number; label: string; type: string }
export class ReferenceFilterEditor extends Disposable {
  private _filters = obsArray<ReturnType<ReferenceFilterEditor["_filter"]>>([]);
  constructor(private _columns: Column[], filters: ReferenceFilter[]) {
    super();
    this._filters.set(filters.map(f => this._filter(f)));
  }

  public buildDom() {
    return dom("div", dom("p", t("All filter conditions must match.")),
      dom.forEach(this._filters, f => cssCondition(
        dom("select", this._columns.map(c => dom("option", { value: String(c.id) }, c.label)),
          dom.prop("value", f.column), dom.on("change", (_ev, el) => f.column.set(el.value))),
        dom("select", ["in", "notIn", "gt", "gte", "lt", "lte"].map((op, i) =>
          dom("option", { value: op }, ["=", "≠", ">", "≥", "<", "≤"][i])),
        dom.prop("value", f.op), dom.on("change", (_ev, el) => f.op.set(el.value as ReferenceFilter["op"]))),
        dom.forEach(f.values, value => dom("div",
          input(value.text, { onInput: true }, dom.prop("disabled", value.isNull)),
          dom("label", dom("input", { type: "checkbox" }, dom.prop("checked", value.isNull),
            dom.on("change", (_ev, el) => value.isNull.set(el.checked))), t("Null value")),
          basicButton(t("Remove value"), dom.on("click", () =>
            f.values.splice(f.values.get().indexOf(value), 1))))),
        basicButton(t("Add value"), dom.on("click", () => f.values.push(this._value("")))),
        basicButton(t("Remove condition"), dom.on("click", () =>
          this._filters.splice(this._filters.get().indexOf(f), 1))),
      )),
      basicButton(t("Add condition"), dom.on("click", () => this._filters.push(this._filter()))));
  }

  public read(): ReferenceFilter[] {
    return this._filters.get().map((f) => {
      const col = this._columns.find(c => String(c.id) === f.column.get());
      if (!col) { throw new Error(t("Unsupported filter column")); }
      const type = col.type.split(":")[0];
      const values = f.values.get().map((value) => {
        if (value.isNull.get()) { return null; }
        const text = value.text.get();
        if (["Int", "Numeric", "Date", "DateTime"].includes(type)) {
          const number = ["Date", "DateTime"].includes(type) && !Number.isFinite(Number(text)) ?
            Date.parse(text) / 1000 : Number(text);
          if (!text.trim() || !Number.isFinite(number)) { throw new Error(t("Invalid filter value")); }
          return number;
        }
        if (type === "Bool") {
          if (!["true", "false"].includes(text)) { throw new Error(t("Use true or false for a boolean filter")); }
          return text === "true";
        }
        if (!["Text", "Choice"].includes(type)) { throw new Error(t("Unsupported filter column")); }
        return text;
      });
      if (!["in", "notIn"].includes(f.op.get()) && (values.length !== 1 || typeof values[0] !== "number")) {
        throw new Error(t("Ordered comparisons require one numeric or date value."));
      }
      return { colRef: col.id, op: f.op.get(), values };
    });
  }

  private _value(value: unknown) {
    return { text: Observable.create(this, String(value ?? "")), isNull: Observable.create(this, value === null) };
  }

  private _filter(filter?: ReferenceFilter) {
    return { column: Observable.create(this, String(filter?.colRef || this._columns[0]?.id || "")),
      op: Observable.create<ReferenceFilter["op"]>(this, filter?.op || "in"),
      values: obsArray((filter?.values || [""]).map(v => this._value(v))) };
  }
}
const cssCondition = styled("div", `border-left: 2px solid #888; padding: 8px; margin: 8px 0;`);
