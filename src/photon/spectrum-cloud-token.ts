/** Issue a short-lived gRPC bearer token from Spectrum Cloud. */
export async function issueSpectrumImessageToken(
  projectId: string,
  projectSecret: string,
): Promise<{ token: string; expiresIn: number; type: string }> {
  const auth = Buffer.from(`${projectId}:${projectSecret}`).toString("base64");
  const res = await fetch(
    `https://spectrum.photon.codes/projects/${projectId}/imessage/tokens`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
    },
  );
  const body = (await res.json()) as {
    succeed?: boolean;
    data?: { token: string; expiresIn: number; type: string };
    message?: string;
  };
  if (!res.ok || !body.succeed || !body.data?.token) {
    throw new Error(body.message ?? `Spectrum token issue failed (${res.status})`);
  }
  return body.data;
}
