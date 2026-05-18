import { expect, type Locator, type Page } from '@playwright/test';

type StaffDoctorFormData = {
  name?: string;
  initials?: string;
  role?: string;
  email?: string;
  googleEmail?: string;
  targetWeeklyHours?: string;
  qualificationIds?: string[];
};

export class StaffPage {
  readonly pageRoot: Locator;
  readonly addButton: Locator;
  readonly form: Locator;
  readonly nameInput: Locator;
  readonly initialsInput: Locator;
  readonly roleTrigger: Locator;
  readonly emailInput: Locator;
  readonly googleEmailInput: Locator;
  readonly targetHoursInput: Locator;
  readonly submitButton: Locator;

  constructor(private readonly page: Page) {
    this.pageRoot = page.getByTestId('staff-page');
    this.addButton = page.getByTestId('staff-add-button');
    this.form = page.getByTestId('staff-doctor-form');
    this.nameInput = page.getByTestId('staff-form-name');
    this.initialsInput = page.getByTestId('staff-form-initials');
    this.roleTrigger = page.getByTestId('staff-form-role-trigger');
    this.emailInput = page.getByTestId('staff-form-email');
    this.googleEmailInput = page.getByTestId('staff-form-google-email');
    this.targetHoursInput = page.getByTestId('staff-form-target-hours');
    this.submitButton = page.getByTestId('staff-form-submit');
  }

  async goto() {
    await this.page.goto('/staff');
    await this.expectLoaded();
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/staff(?:\?|$)/);
    await expect(this.pageRoot).toBeVisible();
  }

  doctorCard(doctorId: string) {
    return this.page.getByTestId(`staff-doctor-card-${doctorId}`);
  }

  doctorEditButton(doctorId: string) {
    return this.page.getByTestId(`staff-doctor-edit-${doctorId}`);
  }

  doctorDeleteButton(doctorId: string) {
    return this.page.getByTestId(`staff-doctor-delete-${doctorId}`);
  }

  doctorDeleteConfirmButton(doctorId: string) {
    return this.page.getByTestId(`staff-doctor-delete-confirm-${doctorId}`);
  }

  doctorDragHandle(doctorId: string) {
    return this.page.getByTestId(`staff-doctor-drag-${doctorId}`);
  }

  doctorQualificationBadge(doctorId: string, qualificationId: string) {
    return this.page.getByTestId(`staff-doctor-qualification-${doctorId}-${qualificationId}`);
  }

  qualificationToggle(qualificationId: string) {
    return this.page.getByTestId(`doctor-qualification-toggle-${qualificationId}`);
  }

  async openCreateForm() {
    await this.addButton.click();
    await expect(this.form).toBeVisible();
  }

  async fillForm(data: StaffDoctorFormData) {
    if (data.name !== undefined) {
      await this.nameInput.fill(data.name);
    }

    if (data.initials !== undefined) {
      await this.initialsInput.fill(data.initials);
    }

    if (data.role !== undefined) {
      await this.roleTrigger.click();
      await this.page.getByRole('option', { name: data.role, exact: true }).click();
    }

    if (data.email !== undefined) {
      await this.emailInput.fill(data.email);
    }

    if (data.googleEmail !== undefined) {
      await this.googleEmailInput.fill(data.googleEmail);
    }

    if (data.targetWeeklyHours !== undefined) {
      await this.targetHoursInput.fill(data.targetWeeklyHours);
    }

    if (data.qualificationIds) {
      for (const qualificationId of data.qualificationIds) {
        await this.qualificationToggle(qualificationId).click();
      }
    }
  }

  async submitForm() {
    await this.submitButton.scrollIntoViewIfNeeded();
    await this.submitButton.click();
    await expect(this.form).toHaveCount(0);
  }

  async createDoctor(data: StaffDoctorFormData) {
    await this.openCreateForm();
    await this.fillForm(data);
    await this.submitForm();
  }

  async editDoctor(doctorId: string, data: StaffDoctorFormData) {
    await this.doctorEditButton(doctorId).click();
    await expect(this.form).toBeVisible();
    await this.fillForm(data);
    await this.submitForm();
  }

  async dragDoctorBefore(sourceDoctorId: string, targetDoctorId: string) {
    const sourceHandle = this.doctorDragHandle(sourceDoctorId);
    const targetCard = this.doctorCard(targetDoctorId);

    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetCard.boundingBox();

    if (!sourceBox || !targetBox) {
      throw new Error('Unable to calculate drag target for staff reorder');
    }

    await this.page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 12, { steps: 12 });
    await this.page.mouse.up();
  }

  async deleteDoctor(doctorId: string) {
    await this.doctorDeleteButton(doctorId).click();
    await this.doctorDeleteConfirmButton(doctorId).click();
    await expect(this.doctorCard(doctorId)).toHaveCount(0);
  }
}
