import { contractRegistry } from "@svalin-agent/chain-config";
import {
  chainContractRegistrySchema,
  type ChainContractRegistry,
} from "@svalin-agent/shared";

export function getContractRegistryRoute(): ChainContractRegistry {
  return chainContractRegistrySchema.parse(contractRegistry);
}
