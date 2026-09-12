// lynx 页面域（pages/**，域=页面名 camelCase）。
const zhPages = {} as const;

export default zhPages;
export type ZhPagesKey = keyof typeof zhPages;
