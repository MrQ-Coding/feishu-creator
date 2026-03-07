export function assertHasHeadingLocator(
  sectionHeading?: string,
  headingPath?: string[],
): void {
  if (!sectionHeading && (!headingPath || headingPath.length === 0)) {
    throw new Error("Either sectionHeading or headingPath is required.");
  }
}
