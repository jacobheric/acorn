const base = `${process.env.RELAY_URL}/api/internal/runs/${process.env.RELAY_RUN_ID}`;
const callbackToken = process.env.RELAY_CALLBACK_TOKEN;
const headers = { Authorization: `Bearer ${callbackToken}`, 'Content-Type': 'application/json' };
const call = async (path, body) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) });
      if (response.ok) return response.json();
      if (response.status < 500) throw new Error(`Coordinator rejected callback: ${response.status}`);
    } catch (error) {
      if (attempt === 2) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error('Coordinator did not accept the callback');
};
const hardStop = setTimeout(() => process.exit(124), 8 * 60 * 1_000);
try {
  const spec = await call('');
  await call('/started', {});
  const result = await execute({ ...spec, onOutput: text => process.stdout.write(text) });
  await call('/complete', result);
  process.exitCode = result.exitCode === 0 ? 0 : 1;
} catch (error) {
  console.error(error.message);
  await call('/error', { message: error.message }).catch(() => {});
  process.exitCode = 1;
} finally {
  clearTimeout(hardStop);
}
