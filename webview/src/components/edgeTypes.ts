import type { EdgeTypes } from "@xyflow/react";
import { CompositeEdge } from "./composite-edge";
import { SingleEdge } from "./single-edge";

export const edgeTypes: EdgeTypes = {
  composite: CompositeEdge,
  single: SingleEdge,
};
