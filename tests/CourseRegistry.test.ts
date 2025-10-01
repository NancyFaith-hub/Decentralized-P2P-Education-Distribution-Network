import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Course {
  educator: string;
  ipfsHash: string;
  title: string;
  description: string;
  timestamp: number;
  versionCount: number;
}

interface CourseVersion {
  ipfsHash: string;
  notes: string;
  timestamp: number;
}

interface CourseCategory {
  category: string;
  tags: string[];
}

interface CourseCollaborator {
  role: string;
  permissions: string[];
  addedAt: number;
}

interface CourseStatus {
  status: string;
  visibility: boolean;
  lastUpdated: number;
}

interface ContractState {
  courses: Map<number, Course>;
  educatorCourseLists: Map<string, number[]>;
  courseVersions: Map<string, CourseVersion>; // Key: `${courseId}-${version}`
  courseCategories: Map<number, CourseCategory>;
  courseCollaborators: Map<string, CourseCollaborator>; // Key: `${courseId}-${collaborator}`
  courseStatus: Map<number, CourseStatus>;
  courseCounter: number;
  contractOwner: string;
  blockHeight: number; // Mock block height
}

// Mock contract implementation
class CourseRegistryMock {
  private state: ContractState = {
    courses: new Map(),
    educatorCourseLists: new Map(),
    courseVersions: new Map(),
    courseCategories: new Map(),
    courseCollaborators: new Map(),
    courseStatus: new Map(),
    courseCounter: 0,
    contractOwner: "deployer",
    blockHeight: 100,
  };

  private ERR_NOT_OWNER = 100;
  private ERR_INVALID_HASH = 101;
  private ERR_INVALID_ID = 102;
  private ERR_ALREADY_REGISTERED = 103;
  private ERR_NOT_AUTHORIZED = 104;
  private ERR_INVALID_PARAM = 105;
  private ERR_MAX_LIST_LIMIT = 106;
  private ERR_NOT_FOUND = 107;

  // Increment block height for each call that uses it
  private incrementBlockHeight() {
    this.state.blockHeight += 1;
  }

  registerCourse(caller: string, ipfsHash: string, title: string, description: string): ClarityResponse<number> {
    this.incrementBlockHeight();
    const courseId = this.state.courseCounter + 1;
    const currentList = this.state.educatorCourseLists.get(caller) ?? [];

    if (ipfsHash.length === 0) {
      return { ok: false, value: this.ERR_INVALID_HASH };
    }
    if (title.length === 0) {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }
    if (currentList.length >= 999) {
      return { ok: false, value: this.ERR_MAX_LIST_LIMIT };
    }

    this.state.courses.set(courseId, {
      educator: caller,
      ipfsHash,
      title,
      description,
      timestamp: this.state.blockHeight,
      versionCount: 1,
    });

    this.state.courseVersions.set(`${courseId}-1`, {
      ipfsHash,
      notes: "Initial version",
      timestamp: this.state.blockHeight,
    });

    this.state.courseStatus.set(courseId, {
      status: "draft",
      visibility: false,
      lastUpdated: this.state.blockHeight,
    });

    this.state.educatorCourseLists.set(caller, [...currentList, courseId]);
    this.state.courseCounter = courseId;

    return { ok: true, value: courseId };
  }

  updateCourseDetails(caller: string, courseId: number, newTitle: string, newDescription: string): ClarityResponse<boolean> {
    const course = this.state.courses.get(courseId);
    if (!course) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }
    if (course.educator !== caller) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    if (newTitle.length === 0 && newDescription.length === 0) {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }

    this.state.courses.set(courseId, {
      ...course,
      title: newTitle.length > 0 ? newTitle : course.title,
      description: newDescription.length > 0 ? newDescription : course.description,
    });

    return { ok: true, value: true };
  }

  registerNewVersion(caller: string, courseId: number, newHash: string, notes: string): ClarityResponse<number> {
    this.incrementBlockHeight();
    const course = this.state.courses.get(courseId);
    if (!course) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }
    if (course.educator !== caller) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    if (newHash.length === 0) {
      return { ok: false, value: this.ERR_INVALID_HASH };
    }

    const newVersion = course.versionCount + 1;
    this.state.courseVersions.set(`${courseId}-${newVersion}`, {
      ipfsHash: newHash,
      notes,
      timestamp: this.state.blockHeight,
    });

    this.state.courses.set(courseId, { ...course, versionCount: newVersion, ipfsHash: newHash });

    const status = this.state.courseStatus.get(courseId)!;
    this.state.courseStatus.set(courseId, { ...status, lastUpdated: this.state.blockHeight });

    return { ok: true, value: newVersion };
  }

  transferOwnership(caller: string, courseId: number, newOwner: string): ClarityResponse<boolean> {
    const course = this.state.courses.get(courseId);
    if (!course) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }
    if (course.educator !== caller) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    if (newOwner === caller) {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }

    this.state.courses.set(courseId, { ...course, educator: newOwner });

    const oldList = this.state.educatorCourseLists.get(caller) ?? [];
    this.state.educatorCourseLists.set(caller, oldList.filter(id => id !== courseId));

    const newList = this.state.educatorCourseLists.get(newOwner) ?? [];
    this.state.educatorCourseLists.set(newOwner, [...newList, courseId]);

    return { ok: true, value: true };
  }

  addCategory(caller: string, courseId: number, category: string, tags: string[]): ClarityResponse<boolean> {
    const course = this.state.courses.get(courseId);
    if (!course) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }
    if (course.educator !== caller) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    if (category.length === 0) {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }

    this.state.courseCategories.set(courseId, { category, tags });

    return { ok: true, value: true };
  }

  addCollaborator(caller: string, courseId: number, collaborator: string, role: string, permissions: string[]): ClarityResponse<boolean> {
    const course = this.state.courses.get(courseId);
    if (!course) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }
    if (course.educator !== caller) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    const key = `${courseId}-${collaborator}`;
    if (this.state.courseCollaborators.has(key)) {
      return { ok: false, value: this.ERR_ALREADY_REGISTERED };
    }

    this.state.courseCollaborators.set(key, {
      role,
      permissions,
      addedAt: this.state.blockHeight,
    });

    return { ok: true, value: true };
  }

  removeCollaborator(caller: string, courseId: number, collaborator: string): ClarityResponse<boolean> {
    const course = this.state.courses.get(courseId);
    if (!course) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }
    if (course.educator !== caller) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    const key = `${courseId}-${collaborator}`;
    if (!this.state.courseCollaborators.has(key)) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }

    this.state.courseCollaborators.delete(key);

    return { ok: true, value: true };
  }

  updateStatus(caller: string, courseId: number, newStatus: string, newVisibility: boolean): ClarityResponse<boolean> {
    this.incrementBlockHeight();
    const course = this.state.courses.get(courseId);
    if (!course) {
      return { ok: false, value: this.ERR_NOT_FOUND };
    }
    if (course.educator !== caller) {
      return { ok: false, value: this.ERR_NOT_OWNER };
    }
    if (newStatus.length === 0) {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }

    this.state.courseStatus.set(courseId, {
      status: newStatus,
      visibility: newVisibility,
      lastUpdated: this.state.blockHeight,
    });

    return { ok: true, value: true };
  }

  getCourse(courseId: number): ClarityResponse<Course | null> {
    return { ok: true, value: this.state.courses.get(courseId) ?? null };
  }

  getCourseVersion(courseId: number, version: number): ClarityResponse<CourseVersion | null> {
    return { ok: true, value: this.state.courseVersions.get(`${courseId}-${version}`) ?? null };
  }

  getCourseCategory(courseId: number): ClarityResponse<CourseCategory | null> {
    return { ok: true, value: this.state.courseCategories.get(courseId) ?? null };
  }

  getCourseCollaborator(courseId: number, collaborator: string): ClarityResponse<CourseCollaborator | null> {
    return { ok: true, value: this.state.courseCollaborators.get(`${courseId}-${collaborator}`) ?? null };
  }

  getCourseStatus(courseId: number): ClarityResponse<CourseStatus | null> {
    return { ok: true, value: this.state.courseStatus.get(courseId) ?? null };
  }

  getCoursesByEducator(educator: string): ClarityResponse<number[] | null> {
    return { ok: true, value: this.state.educatorCourseLists.get(educator) ?? null };
  }

  getCourseCount(): ClarityResponse<number> {
    return { ok: true, value: this.state.courseCounter };
  }

  isOwner(courseId: number, user: string): ClarityResponse<boolean> {
    const course = this.state.courses.get(courseId);
    return { ok: true, value: !!course && course.educator === user };
  }

  hasPermission(courseId: number, user: string, permission: string): ClarityResponse<boolean> {
    const collab = this.state.courseCollaborators.get(`${courseId}-${user}`);
    if (!collab) {
      return { ok: true, value: false };
    }
    return { ok: true, value: collab.permissions.includes(permission) };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  educator1: "wallet_1",
  educator2: "wallet_2",
  collaborator: "wallet_3",
};

describe("CourseRegistry Contract", () => {
  let contract: CourseRegistryMock;

  beforeEach(() => {
    contract = new CourseRegistryMock();
    vi.resetAllMocks();
  });

  it("should register a new course successfully", () => {
    const result = contract.registerCourse(accounts.educator1, "QmHash123", "Course Title", "Description");
    expect(result).toEqual({ ok: true, value: 1 });

    const course = contract.getCourse(1);
    expect(course.value).toEqual(expect.objectContaining({
      educator: accounts.educator1,
      ipfsHash: "QmHash123",
      title: "Course Title",
      description: "Description",
      versionCount: 1,
    }));

    const version = contract.getCourseVersion(1, 1);
    expect(version.value).toEqual(expect.objectContaining({ ipfsHash: "QmHash123" }));

    const status = contract.getCourseStatus(1);
    expect(status.value).toEqual(expect.objectContaining({ status: "draft", visibility: false }));

    const coursesList = contract.getCoursesByEducator(accounts.educator1);
    expect(coursesList.value).toEqual([1]);
  });

  it("should prevent registration with invalid hash", () => {
    const result = contract.registerCourse(accounts.educator1, "", "Title", "Desc");
    expect(result).toEqual({ ok: false, value: 101 });
  });

  it("should update course details", () => {
    contract.registerCourse(accounts.educator1, "QmHash", "Old Title", "Old Desc");

    const updateResult = contract.updateCourseDetails(accounts.educator1, 1, "New Title", "");
    expect(updateResult).toEqual({ ok: true, value: true });

    const course = contract.getCourse(1);
    expect(course.value).toEqual(expect.objectContaining({ title: "New Title", description: "Old Desc" }));
  });

  it("should prevent non-owner from updating details", () => {
    contract.registerCourse(accounts.educator1, "QmHash", "Title", "Desc");

    const updateResult = contract.updateCourseDetails(accounts.educator2, 1, "New Title", "");
    expect(updateResult).toEqual({ ok: false, value: 100 });
  });

  it("should register new version", () => {
    contract.registerCourse(accounts.educator1, "OldHash", "Title", "Desc");

    const versionResult = contract.registerNewVersion(accounts.educator1, 1, "NewHash", "Update notes");
    expect(versionResult).toEqual({ ok: true, value: 2 });

    const course = contract.getCourse(1);
    expect(course.value).toEqual(expect.objectContaining({ versionCount: 2, ipfsHash: "NewHash" }));

    const version = contract.getCourseVersion(1, 2);
    expect(version.value).toEqual(expect.objectContaining({ ipfsHash: "NewHash", notes: "Update notes" }));
  });

  it("should transfer ownership", () => {
    contract.registerCourse(accounts.educator1, "QmHash", "Title", "Desc");

    const transferResult = contract.transferOwnership(accounts.educator1, 1, accounts.educator2);
    expect(transferResult).toEqual({ ok: true, value: true });

    const course = contract.getCourse(1);
    expect(course.value?.educator).toBe(accounts.educator2);

    const list1 = contract.getCoursesByEducator(accounts.educator1);
    expect(list1.value).toEqual([]);

    const list2 = contract.getCoursesByEducator(accounts.educator2);
    expect(list2.value).toEqual([1]);
  });

  it("should add and remove collaborator", () => {
    contract.registerCourse(accounts.educator1, "QmHash", "Title", "Desc");

    const addResult = contract.addCollaborator(accounts.educator1, 1, accounts.collaborator, "Editor", ["edit", "view"]);
    expect(addResult).toEqual({ ok: true, value: true });

    const collab = contract.getCourseCollaborator(1, accounts.collaborator);
    expect(collab.value).toEqual(expect.objectContaining({ role: "Editor", permissions: ["edit", "view"] }));

    const hasPerm = contract.hasPermission(1, accounts.collaborator, "edit");
    expect(hasPerm.value).toBe(true);

    const removeResult = contract.removeCollaborator(accounts.educator1, 1, accounts.collaborator);
    expect(removeResult).toEqual({ ok: true, value: true });

    const collabAfter = contract.getCourseCollaborator(1, accounts.collaborator);
    expect(collabAfter.value).toBeNull();
  });

  it("should update status", () => {
    contract.registerCourse(accounts.educator1, "QmHash", "Title", "Desc");

    const updateResult = contract.updateStatus(accounts.educator1, 1, "published", true);
    expect(updateResult).toEqual({ ok: true, value: true });

    const status = contract.getCourseStatus(1);
    expect(status.value).toEqual(expect.objectContaining({ status: "published", visibility: true }));
  });

  it("should check ownership correctly", () => {
    contract.registerCourse(accounts.educator1, "QmHash", "Title", "Desc");

    const isOwner1 = contract.isOwner(1, accounts.educator1);
    expect(isOwner1.value).toBe(true);

    const isOwner2 = contract.isOwner(1, accounts.educator2);
    expect(isOwner2.value).toBe(false);
  });

  it("should handle max list limit", () => {
    // Simulate max list by setting internal state
    const longList = Array.from({ length: 999 }, (_, i) => i + 1);
    contract.state.educatorCourseLists.set(accounts.educator1, longList);

    const result = contract.registerCourse(accounts.educator1, "QmHash", "Title", "Desc");
    expect(result).toEqual({ ok: false, value: 106 });
  });
});