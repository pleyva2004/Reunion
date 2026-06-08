import type { PollAdapter } from "./imessage-adapter.js";
import { MockPollAdapter } from "./imessage-adapter.mock.js";
import { RealPollAdapter } from "./imessage-adapter.real.js";
import { GrpcPollAdapter } from "./grpc-poll-adapter.js";
import { issueSpectrumImessageToken } from "./spectrum-cloud-token.js";
import { config } from "../config.js";
import { logger } from "../observability/logger.js";

const CLOUD_GRPC_ADDRESS =
  process.env.SPECTRUM_IMESSAGE_ADDRESS ?? "imessage.spectrum.photon.codes:443";

function resolveGrpcPollAdapter(): PollAdapter | null {
  const { grpcAddress, grpcToken, grpcTls } = config.imessage;
  const { projectId, projectSecret } = config.spectrum;

  if (grpcAddress && grpcToken) {
    return new GrpcPollAdapter({
      address: grpcAddress,
      token: grpcToken,
      tls: grpcTls,
    });
  }

  if (projectId && projectSecret && (!grpcAddress || grpcAddress === CLOUD_GRPC_ADDRESS)) {
    let cached: { token: string; expiresAt: number } | null = null;
    return new GrpcPollAdapter({
      address: grpcAddress ?? CLOUD_GRPC_ADDRESS,
      tls: grpcTls,
      token: async () => {
        if (cached && Date.now() < cached.expiresAt - 30_000) return cached.token;
        const issued = await issueSpectrumImessageToken(projectId, projectSecret);
        cached = {
          token: issued.token,
          expiresAt: Date.now() + issued.expiresIn * 1000,
        };
        return issued.token;
      },
    });
  }

  return null;
}

/** Select the Photon poll adapter based on PHOTON_MODE and iMessage credentials. */
export function createPollAdapter(): PollAdapter {
  if (config.photonMode === "real") {
    const grpc = resolveGrpcPollAdapter();
    if (grpc) {
      logger.info(
        { address: config.imessage.grpcAddress ?? CLOUD_GRPC_ADDRESS },
        "using @photon-ai/advanced-imessage gRPC poll adapter",
      );
      return grpc;
    }

    logger.info("using real @photon-ai/advanced-imessage-kit adapter");
    return new RealPollAdapter({
      serverUrl: config.imessage.serverUrl,
      apiKey: config.imessage.apiKey,
    });
  }
  logger.info("using mock iMessage poll adapter (PHOTON_MODE=mock)");
  return new MockPollAdapter();
}
