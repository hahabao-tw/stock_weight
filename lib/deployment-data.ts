export function shouldDeployEveningData(
  generatedDataDate: string,
  publishedDataDate: string,
): boolean {
  if (!generatedDataDate || !publishedDataDate) {
    throw new Error('資料日期缺漏，無法判斷是否需要部署。');
  }

  return generatedDataDate !== publishedDataDate;
}
