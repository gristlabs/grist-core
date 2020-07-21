import * as t from "ts-interface-checker";
// tslint:disable:object-literal-key-quotes

export const CustomSectionAPI = t.iface([], {
  "createSection": t.func("void", t.param("inlineTarget", "RenderTarget")),
});

const exportedTypeSuite: t.ITypeSuite = {
  CustomSectionAPI,
};
export default exportedTypeSuite;
