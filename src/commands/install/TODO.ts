import { InstallationPlan, DependencyInstallation } from "../../types";
import { getPackageMetadata } from "../../util/registry";
import semver from "semver";

interface PackageMetadata {
  versions: Record<string, {
    dependencies: Record<string, string>;
  }>;
}

interface PackageNode {
  name: string;
  versionRequirements: Set<string>;
  dependencies: Map<string, Set<string>>; // dependency name -> Set of version ranges
}

/**
 *
 * @param topLevelDependencies The list of dependencies as determined by package.json's `dependencies` object
 * @returns The installation plan
 */
export async function constructInstallationPlan(
  topLevelDependencies: Record<string, string>
): Promise<InstallationPlan> {
  // Cache for package metadata to avoid duplicate network calls
  const metadataCache = new Map<string, PackageMetadata>();
  
  // Package graph for all dependencies
  const packageGraph = new Map<string, PackageNode>();
  
  // Final installation plan
  const installationPlan: InstallationPlan = [];
  
  // Fetch metadata and build the complete package graph
  async function buildDependencyGraph(
    name: string,
    versionRange: string,
    parentPackage?: string
  ): Promise<void> {
    console.log(`Building graph node for ${name}@${versionRange}`);
    // Create or update package node
    if (!packageGraph.has(name)) {
      packageGraph.set(name, {
        name,
        versionRequirements: new Set(),
        dependencies: new Map()
      });
    }
    
    const packageNode = packageGraph.get(name)!;
    packageNode.versionRequirements.add(versionRange);
    
    // Fetch metadata (from cache if possible)
    if (!metadataCache.has(name)) {
      console.log('cache miss');
      const metadata = await getPackageMetadata(name);

      // Only store the versions information we need
      metadataCache.set(name, {
        versions: metadata.versions || {}
      });
    } else {
      console.log('cache hit');
    }
    
    const metadata = metadataCache.get(name)!;
    const availableVersions = Object.keys(metadata.versions || {});
    
    // Resolve version
    const resolvedVersion = semver.maxSatisfying(availableVersions, versionRange);
    
    if (!resolvedVersion) {
      throw new Error(`Cannot resolve ${name}@${versionRange}`);
    }
    
    // Get dependencies for this version
    const packageJson = metadata.versions[resolvedVersion];
    if (!packageJson) {
      throw new Error(`Version data for ${name}@${resolvedVersion} not found`);
    }
    
    const dependencies = packageJson.dependencies || {};
    
    // Add dependencies to this package node
    for (const [depName, depVersionRange] of Object.entries(dependencies)) {
      if (!packageNode.dependencies.has(depName)) {
        packageNode.dependencies.set(depName, new Set());
      }
      packageNode.dependencies.get(depName)!.add(depVersionRange as string);
      
      // Process each dependency
      await buildDependencyGraph(depName, depVersionRange as string, name);
    }
  }
  
  // Determine optimal version for each package
  function findOptimalVersion(name: string): string {
    const packageNode = packageGraph.get(name)!;
    const metadata = metadataCache.get(name)!;
    const availableVersions = Object.keys(metadata.versions || {});
    
    // For each available version, count how many ranges it satisfies
    const versionSatisfactionCount = new Map<string, number>();
    
    for (const version of availableVersions) {
      let satisfiedCount = 0;
      
      for (const range of packageNode.versionRequirements) {
        if (semver.satisfies(version, range)) {
          satisfiedCount++;
        }
      }
      
      versionSatisfactionCount.set(version, satisfiedCount);
    }
    
    // Find version that satisfies most ranges (prefer higher versions if tied)
    let bestVersion = '';
    let maxSatisfied = 0;
    
    for (const [version, count] of versionSatisfactionCount.entries()) {
      if (count > maxSatisfied || 
          (count === maxSatisfied && bestVersion && semver.gt(version, bestVersion))) {
        maxSatisfied = count;
        bestVersion = version;
      }
    }
    
    if (!bestVersion) {
      throw new Error(`Could not find optimal version for ${name}`);
    }
    
    return bestVersion;
  }
  
  // Build installation plan
  async function buildInstallationPlan(optimalVersions: Map<string, string>): Promise<InstallationPlan> {
    const rootPackages = new Map<string, string>();
    const plan: InstallationPlan = [];
    
    
    // Process function to create installation plan
    function processDependency(
      name: string,
      versionRange: string,
      parentPath?: string
    ): void {
      const optimalVersion = optimalVersions.get(name)!;
      const satisfiesRange = semver.satisfies(optimalVersion, versionRange);
      
      if (satisfiesRange) {
        const version = optimalVersion;
        
        // Already installed at root with same version? Skip
        if (rootPackages.has(name) && rootPackages.get(name) === version) {
          return;
        }
        
        // Check if we have a conflict at root
        const isConflict = rootPackages.has(name) && rootPackages.get(name) !== version;
        
        if (!isConflict) {
          // Can install at root
          rootPackages.set(name, version);
          plan.push({ name, version });
        } else {
          // Conflict, install nested
          plan.push({
            name,
            version,
            parentDirectory: parentPath
          });
        }
        
        // Process dependencies
        const packageNode = packageGraph.get(name)!;
        for (const [depName, depVersionRanges] of packageNode.dependencies.entries()) {
          // Just pick the first version range for simplicity
          // In a more advanced implementation, you might want to be smarter here
          const depVersionRange = [...depVersionRanges][0];
          
          const newParentPath = isConflict || parentPath 
            ? `${parentPath || ''}${parentPath ? '/' : ''}${name}/node_modules` 
            : `${name}/node_modules`;
            
          processDependency(depName, depVersionRange, newParentPath);
        }
      } else {
        // Optimal version doesn't satisfy this range, need to use specific version
        const metadata = metadataCache.get(name)!;
        const availableVersions = Object.keys(metadata.versions || {});
        
        // Resolve to best version for this specific range
        const version = semver.maxSatisfying(availableVersions, versionRange);
        
        if (!version) {
          throw new Error(`Cannot resolve ${name}@${versionRange}`);
        }
        
        // Always install nested since this is a specific version requirement
        plan.push({
          name,
          version,
          parentDirectory: parentPath
        });
        
        // Process dependencies
        const packageJson = metadata.versions[version];
        const dependencies = packageJson.dependencies || {};
        
        for (const [depName, depVersionRange] of Object.entries(dependencies)) {
          const newParentPath = `${parentPath || ''}${parentPath ? '/' : ''}${name}/node_modules`;
          processDependency(depName, depVersionRange as string, newParentPath);
        }
      }
    }
    
    // Start with top-level dependencies
    for (const [name, versionRange] of Object.entries(topLevelDependencies)) {
      processDependency(name, versionRange);
    }
    
    return plan;
  }
  
  // Main execution flow
  try {
    // Build complete dependency graph (with single traversal)
    for (const [name, versionRange] of Object.entries(topLevelDependencies)) {
      await buildDependencyGraph(name, versionRange);
    }
    
    // Calculate optimal versions
    const optimalVersions = new Map<string, string>();
    for (const [name, packageNode] of packageGraph.entries()) {
      optimalVersions.set(name, findOptimalVersion(name));
    }
    
    const plan = await buildInstallationPlan(optimalVersions);

    // Visualize the installation tree
    console.log(visualizeInstallationTree(plan));

    return plan;
  } catch (error) {
    console.error("Error constructing installation plan:", error);
    throw error;
  }
}

// async function resolveVersion(name: string, versionRange: string): Promise<string> {
//   // Get metadata for the package
//   const metadata = await getPackageMetadata(name);
  
//   // Extract all available versions
//   const availableVersions = Object.keys(metadata.versions || {});
  
//   // Find the highest version that satisfies the range
//   const resolvedVersion = semver.maxSatisfying(availableVersions, versionRange);
  
//   if (!resolvedVersion) {
//     throw new Error(`Cannot resolve version range ${versionRange} for package ${name}`);
//   }
  
//   return resolvedVersion;
// }

function visualizeInstallationTree(installationPlan: InstallationPlan): string {
  let output = "Installation Tree Structure\n";
  output += "==========================\n\n";
  output += "node_modules/\n";
  
  // Track packages installed at root
  const rootPackages = installationPlan
    .filter(item => !item.parentDirectory)
    .sort((a, b) => a.name.localeCompare(b.name));
  
  // Organize nested packages by their parent directories
  const nestedPackages = new Map<string, DependencyInstallation[]>();
  
  for (const item of installationPlan) {
    if (item.parentDirectory) {
      if (!nestedPackages.has(item.parentDirectory)) {
        nestedPackages.set(item.parentDirectory, []);
      }
      nestedPackages.get(item.parentDirectory)!.push(item);
    }
  }
  
  // Function to recursively print the tree structure
  function printTree(
    packages: DependencyInstallation[],
    basePath: string = "",
    indent: string = "│   "
  ): string {
    let result = "";
    
    // Sort packages alphabetically for consistent output
    const sortedPackages = [...packages].sort((a, b) => a.name.localeCompare(b.name));
    
    for (let i = 0; i < sortedPackages.length; i++) {
      const pkg = sortedPackages[i];
      const isLast = i === sortedPackages.length - 1;
      const prefix = isLast ? "└── " : "├── ";
      
      // Print this package
      result += `${indent}${prefix}${pkg.name}@${pkg.version}\n`;
      
      // Calculate the next level path for this package
      const nextPath = basePath ? 
        `${basePath}/${pkg.name}/node_modules` : 
        `${pkg.name}/node_modules`;
      
      // Check if this package has nested dependencies
      if (nestedPackages.has(nextPath)) {
        const nextIndent = indent + (isLast ? "    " : "│   ");
        
        // Add node_modules folder
        result += `${indent}${isLast ? "    " : "│   "}└── node_modules\n`;
        
        // Print nested packages
        result += printTree(
          nestedPackages.get(nextPath)!,
          nextPath,
          nextIndent + "    "
        );
      }
    }
    
    return result;
  }
  
  // Print root level packages
  output += printTree(rootPackages, "", "");
  
  // Add some statistics
  const rootCount = rootPackages.length;
  const nestedCount = installationPlan.length - rootCount;
  const maxNestingLevel = Math.max(
    0,
    ...Array.from(nestedPackages.keys())
      .map(path => path.split('/').filter(p => p === 'node_modules').length)
  );
  
  output += "\nInstallation Statistics:\n";
  output += `Total packages: ${installationPlan.length}\n`;
  output += `Root packages: ${rootCount}\n`;
  output += `Nested packages: ${nestedCount}\n`;
  output += `Maximum nesting depth: ${maxNestingLevel}\n`;
  output += `Flattening efficiency: ${Math.round((rootCount / installationPlan.length) * 100)}%\n`;
  
  return output;
}