import { getWeightsPayload } from '@/lib/official-market-data';

export async function GET(request: Request) {
  const forceRefresh = new URL(request.url).searchParams.get('refresh') === '1';

  try {
    const payload = await getWeightsPayload(forceRefresh);
    return Response.json(payload, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : '無法取得官方市場資料。';
    return Response.json(
      { error: message },
      {
        status: 502,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
