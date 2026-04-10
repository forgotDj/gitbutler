import { Route as rootRoute } from "#ui/routes/__root.tsx";
import { Route as indexRoute } from "#ui/routes/index.tsx";
import { Route as projectRoute } from "#ui/routes/project/$id/route.tsx";
import { Route as projectBranchesRoute } from "#ui/routes/project/$id/branches/route.tsx";
import { Route as projectWorkspaceRoute } from "#ui/routes/project/$id/workspace/route.tsx";

const projectRouteTree = projectRoute.addChildren([projectBranchesRoute, projectWorkspaceRoute]);

export const routeTree = rootRoute.addChildren([indexRoute, projectRouteTree]);
