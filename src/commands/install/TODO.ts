import { InstallationPlan, DependencyInstallation } from "../../types";
import { getPackageMetadata } from "../../util/registry";
import semver from "semver";

/**
 *
 * @param topLevelDependencies The list of dependencies as determined by package.json's `dependencies` object
 * @returns The installation plan
 */
export async function constructInstallationPlan(
  topLevelDependencies: Record<string, string>
): Promise<InstallationPlan> {
  const dependenciesToInstall = new Map<string, DependencyInstallation>();

  for (const [name, versionRange] of Object.entries(topLevelDependencies)) {
    await resolveDependencyTree(name, versionRange, dependenciesToInstall);
  }

  const result = Array.from(dependenciesToInstall.values());
  console.log(result);
  return result;
}

function resolveVersion(versions: Record<string, any>, versionRange: string): string {
  const availableVersions = Object.keys(versions);

  const resolvedVersion = semver.maxSatisfying(availableVersions, versionRange);
  if (!resolvedVersion) {
    throw new Error(`Cannot resolve version range ${versionRange}`);
  }
  
  return resolvedVersion;
}

async function resolveDependencyTree(
  name: string, 
  versionRange: string,
  visited: Map<string, DependencyInstallation> = new Map(),
  parentPath: string = ''
): Promise<void> {
  // Create a unique key for this dependency and version range
  const depKey = `${name}@${versionRange}`;
  if(visited.has(depKey))
    return;

  const metaData = await getPackageMetadata(name);
  const version = resolveVersion(metaData.versions, versionRange);
  const packageJson = metaData.versions[version];

  const dependencyInstallation: DependencyInstallation = {
    name,
    version,
    // Only add parentDirectory if this isn't a top-level dependency
    ...(parentPath ? { parentDirectory: parentPath } : {})
  };

  visited.set(depKey, dependencyInstallation);

  // recursivly handle any dependencies (if any)
  if(packageJson.dependencies) {
    const subDependencies = packageJson.dependencies;
    
    let newParentPath;
    
    if (!parentPath) {
      // Top-level dependency: its subdependencies go in its node_modules
      newParentPath = `${name}/node_modules`;
    } else {
      // This is already a nested dependency
      newParentPath = `${parentPath}/${name}/node_modules`;
    }

    for (const [subDepName, subDepVersion] of Object.entries(subDependencies)) {
      await resolveDependencyTree(
        subDepName,
        subDepVersion as string,
        visited,
        newParentPath
      );
    }
  }
}