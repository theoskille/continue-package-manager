import { constructInstallationPlan, PackageMetadata } from "./TODO";
import { getPackageMetadata } from "../../util/registry";
import { InstallationPlan, DependencyInstallation } from "../../types";
import semver from "semver";


// Mock only the external API dependency
jest.mock("../../util/registry");

// Predefined test package data
const testPackages: Record<string, PackageMetadata> = {
  "simple-package": {
    versions: {
      "1.0.0": { dependencies: {} },
      "1.1.0": { dependencies: {} }
    }
  },
  "package-a": {
    versions: {
      "1.0.0": { 
        dependencies: {} 
      },
      "2.0.0": {
        dependencies: {
          "package-b": "^1.0.0"
        }
      }
    }
  },
  "package-b": {
    versions: {
      "1.0.0": { dependencies: {} },
      "1.2.0": { dependencies: {} }
    }
  },
  "complex-package": {
    versions: {
      "3.0.0": {
        dependencies: {
          "package-a": "^1.0.0",
          "package-b": "^1.0.0"
        }
      }
    }
  },
  "package-c": {
    versions: {
        "1.0.0": { 
        dependencies: {
            "shared-dep": "^1.0.0"
        } 
        }
    }
    },
    "package-d": {
        versions: {
            "1.0.0": {
            dependencies: {
                "shared-dep": "^2.0.0"
            }
            }
        }
    },
    "shared-dep": {
        versions: {
            "1.0.0": { dependencies: {} },
            "1.5.0": { dependencies: {} },
            "2.0.0": { dependencies: {} }
        }
    },
    "package-e": {
  versions: {
    "1.0.0": { 
      dependencies: {
        "shared-dep-2": "^1.0.0"
      } 
    }
  }
},
"package-f": {
  versions: {
    "1.0.0": {
      dependencies: {
        "shared-dep-2": "^1.0.0"
      }
    }
  }
},
"root-package": {
  versions: {
    "1.0.0": {
      dependencies: {
        "shared-dep-2": "^2.0.0",
        "package-e": "^1.0.0",
        "package-f": "^1.0.0"
      }
    }
  }
},
"shared-dep-2": {
  versions: {
    "1.0.0": { dependencies: {} },
    "1.2.0": { dependencies: {} },
    "2.0.0": { dependencies: {} }
  }
},
"multi-req-a": {
  versions: {
    "1.0.0": { 
      dependencies: {
        "shared-package": "^1.5.0"
      } 
    }
  }
},
"multi-req-b": {
  versions: {
    "1.0.0": {
      dependencies: {
        "shared-package": "^1.2.0"
      }
    }
  }
},
"multi-req-c": {
  versions: {
    "1.0.0": {
      dependencies: {
        "shared-package": "^1.0.0"
      }
    }
  }
},
"multi-req-d": {
  versions: {
    "1.0.0": {
      dependencies: {
        "shared-package": "^2.0.0"
      }
    }
  }
},
"shared-package": {
  versions: {
    "1.0.0": { dependencies: {} },
    "1.2.0": { dependencies: {} },
    "1.5.0": { dependencies: {} },
    "1.7.0": { dependencies: {} },
    "2.0.0": { dependencies: {} }
  }
}
};

describe("constructInstallationPlan", () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Mock console.log to avoid cluttering test output
    // console.log = jest.fn();

    // Set up getPackageMetadata mock to use our test packages
    (getPackageMetadata as jest.Mock).mockImplementation((packageName: string): PackageMetadata => {
      const packageData = testPackages[packageName];
      if (!packageData) {
        throw new Error(`Test package not defined: ${packageName}`);
      }
      return packageData;
    });
  });

  test("should create a minimal installation plan with a single package", async () => {
    const topLevelDependencies: Record<string, string> = {
      "simple-package": "^1.0.0"
    };

    const plan: InstallationPlan = await constructInstallationPlan(topLevelDependencies);
    
    // Verify the results
    expect(plan).toHaveLength(1);
    expect(plan[0]).toEqual({
      name: "simple-package",
      version: "1.1.0" // Should select the latest version
    });
    
    // Check that getPackageMetadata was called exactly once
    expect(getPackageMetadata).toHaveBeenCalledTimes(1);
    expect(getPackageMetadata).toHaveBeenCalledWith("simple-package");
  });

  test("should handle a package with a single dependency", async () => {
    const topLevelDependencies: Record<string, string> = {
      "package-a": "^2.0.0"
    };

    const plan: InstallationPlan = await constructInstallationPlan(topLevelDependencies);
    
    // Verify the results
    expect(plan).toHaveLength(2);
    
    // Check that package-a is installed at the root
    const packageA: DependencyInstallation | undefined = plan.find(p => p.name === "package-a");
    expect(packageA).toEqual({
      name: "package-a",
      version: "2.0.0"
    });
    
    // Check that package-b is installed at the root
    const packageB: DependencyInstallation | undefined = plan.find(p => p.name === "package-b");
    expect(packageB).toEqual({
      name: "package-b",
      version: "1.2.0" // Should select the latest version
    });
    
    // Verify that getPackageMetadata was called for both packages
    expect(getPackageMetadata).toHaveBeenCalledTimes(2);
    expect(getPackageMetadata).toHaveBeenCalledWith("package-a");
    expect(getPackageMetadata).toHaveBeenCalledWith("package-b");
  });

  test("should handle a complex package with multiple dependencies", async () => {
    const topLevelDependencies: Record<string, string> = {
      "complex-package": "^3.0.0"
    };

    const plan: InstallationPlan = await constructInstallationPlan(topLevelDependencies);
    
    // Verify the plan contains all expected packages
    expect(plan).toHaveLength(3);
    
    // Check each package is in the plan with correct version
    const complexPackage: DependencyInstallation | undefined = plan.find(p => p.name === "complex-package");
    expect(complexPackage).toEqual({
      name: "complex-package",
      version: "3.0.0"
    });
    
    const packageA: DependencyInstallation | undefined = plan.find(p => p.name === "package-a");
    expect(packageA).toEqual({
      name: "package-a",
      version: "1.0.0"
    });
    
    const packageB: DependencyInstallation | undefined = plan.find(p => p.name === "package-b");
    expect(packageB).toEqual({
      name: "package-b",
      version: "1.2.0" // Should select the latest version
    });
    
    // Verify API calls
    expect(getPackageMetadata).toHaveBeenCalledTimes(3);
  });

  test("should handle nested dependencies with version conflicts", async () => {
    const topLevelDependencies: Record<string, string> = {
      "package-c": "^1.0.0",
      "package-d": "^1.0.0"
    };
  
    const plan: InstallationPlan = await constructInstallationPlan(topLevelDependencies);
    
    // Verify we have the expected number of packages (4 total)
    expect(plan).toHaveLength(4);
    
    // Check each package is in the plan
    const packageC = plan.find(p => p.name === "package-c");
    expect(packageC).toEqual({
      name: "package-c",
      version: "1.0.0"
    });
    
    const packageD = plan.find(p => p.name === "package-d");
    expect(packageD).toEqual({
      name: "package-d",
      version: "1.0.0"
    });
    
    // Find the shared-dep instances
    const sharedDeps = plan.filter(p => p.name === "shared-dep");
    expect(sharedDeps).toHaveLength(2);
    
    // We should have one shared-dep at the root (the newer version)
    const rootSharedDep = sharedDeps.find(p => !p.parentDirectory);
    expect(rootSharedDep).toEqual({
      name: "shared-dep",
      version: "2.0.0"
    });
    
    // And one nested under package-c's node_modules (the older version)
    const nestedSharedDep = sharedDeps.find(p => p.parentDirectory);
    expect(nestedSharedDep).toEqual({
      name: "shared-dep",
      version: "1.5.0", // Should select the latest version in the 1.x range
      parentDirectory: "package-c/node_modules"
    });
    
    // Verify that getPackageMetadata was called for all packages
    expect(getPackageMetadata).toHaveBeenCalledTimes(3);
    expect(getPackageMetadata).toHaveBeenCalledWith("package-c");
    expect(getPackageMetadata).toHaveBeenCalledWith("package-d");
    expect(getPackageMetadata).toHaveBeenCalledWith("shared-dep");
  });

  test("should handle multiple packages requiring lower version dependencies", async () => {
    const topLevelDependencies: Record<string, string> = {
      "root-package": "^1.0.0"
    };
  
    const plan: InstallationPlan = await constructInstallationPlan(topLevelDependencies);
    
    // We expect 6 packages total: root-package, package-e, package-f, 
    // one shared-dep-2 at root level, and two nested shared-dep-2 instances
    expect(plan).toHaveLength(6);
    
    // Check root package is installed
    const rootPackage = plan.find(p => p.name === "root-package");
    expect(rootPackage).toEqual({
      name: "root-package",
      version: "1.0.0"
    });
    
    // Check package-e and package-f are installed
    const packageE = plan.find(p => p.name === "package-e");
    expect(packageE).toEqual({
      name: "package-e",
      version: "1.0.0"
    });
    
    const packageF = plan.find(p => p.name === "package-f");
    expect(packageF).toEqual({
      name: "package-f",
      version: "1.0.0"
    });
    
    // Find all the shared-dep-2 instances
    const sharedDeps = plan.filter(p => p.name === "shared-dep-2");
    expect(sharedDeps).toHaveLength(3);
    
    // We should have one shared-dep-2 at the root (version 2.0.0)
    const rootSharedDep = sharedDeps.find(p => !p.parentDirectory);
    expect(rootSharedDep).toEqual({
      name: "shared-dep-2",
      version: "2.0.0"
    });
    
    // Find the nested shared-dep-2 under package-e
    const packageESharedDep = sharedDeps.find(p => 
      p.parentDirectory && p.parentDirectory.includes("package-e/node_modules")
    );
    expect(packageESharedDep).toBeDefined();
    expect(packageESharedDep?.version).toBe("1.2.0"); // Highest version that satisfies ^1.0.0
    
    // Find the nested shared-dep-2 under package-f
    const packageFSharedDep = sharedDeps.find(p => 
      p.parentDirectory && p.parentDirectory.includes("package-f/node_modules")
    );
    expect(packageFSharedDep).toBeDefined();
    expect(packageFSharedDep?.version).toBe("1.2.0"); // Highest version that satisfies ^1.0.0
    
    // Verify that getPackageMetadata was called for all unique packages
    expect(getPackageMetadata).toHaveBeenCalledTimes(4);
    expect(getPackageMetadata).toHaveBeenCalledWith("root-package");
    expect(getPackageMetadata).toHaveBeenCalledWith("package-e");
    expect(getPackageMetadata).toHaveBeenCalledWith("package-f");
    expect(getPackageMetadata).toHaveBeenCalledWith("shared-dep-2");
  });

  test("should prioritize versions that satisfy the most requirements", async () => {
    const topLevelDependencies: Record<string, string> = {
      "multi-req-a": "^1.0.0",
      "multi-req-b": "^1.0.0",
      "multi-req-c": "^1.0.0",
      "multi-req-d": "^1.0.0"
    };
  
    const plan: InstallationPlan = await constructInstallationPlan(topLevelDependencies);
    
    // Check all packages are installed
    const packages = [
      "multi-req-a", "multi-req-b", "multi-req-c", "multi-req-d", "shared-package"
    ];
    
    // Verify each package is in the plan
    for (const pkg of packages) {
      expect(plan.some(p => p.name === pkg)).toBeTruthy();
    }
    
    // Find all shared-package instances
    const sharedPackages = plan.filter(p => p.name === "shared-package");
    
    // We should have at least one at the root level
    const rootSharedPackage = sharedPackages.find(p => !p.parentDirectory);
    expect(rootSharedPackage).toBeDefined();
    
    // The version at the root should be the one that satisfies the most dependencies
    // Version 1.7.0 satisfies ^1.5.0, ^1.2.0, and ^1.0.0 (3 out of 4 requirements)
    expect(rootSharedPackage?.version).toBe("1.7.0");
    
    // The remaining package should have its own version
    const nestedSharedPackage = sharedPackages.find(p => 
      p.parentDirectory && p.parentDirectory.includes("multi-req-d")
    );
    expect(nestedSharedPackage).toBeDefined();
    expect(nestedSharedPackage?.version).toBe("2.0.0");
    
    // Verify that getPackageMetadata was called for all packages
    expect(getPackageMetadata).toHaveBeenCalledTimes(5);
    
    // Count the total instances of shared-package
    expect(sharedPackages.length).toBe(2); // One at root, one nested
  });
});