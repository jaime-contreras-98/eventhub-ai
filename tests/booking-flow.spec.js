import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://eventhub.rahulshettyacademy.com';
const ISOLATED_USER_EMAIL = 'rahulshetty1@yahoo.com';
const USER_PASSWORD = 'Magiclife1!';

async function login(page, email = ISOLATED_USER_EMAIL) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByPlaceholder('you@email.com').fill(email);
  await page.getByLabel('Password').fill(USER_PASSWORD);
  await page.locator('#login-btn').click();
  await expect(page.getByRole('link', { name: /Browse Events/i }).first()).toBeVisible();
}

async function openFirstAvailableEvent(page) {
  await page.goto(`${BASE_URL}/events`);
  const card = page.getByTestId('event-card').filter({
    has: page.getByRole('link', { name: 'Book Now', exact: true }),
  }).first();
  await expect(card).toBeVisible();
  const title = (await card.locator('h3').textContent())?.trim() ?? '';
  await card.getByRole('link', { name: 'Book Now', exact: true }).click();
  await expect(page).toHaveURL(/\/events\/\d+/);
  return title;
}

async function openEventWithAtLeastTwoSeats(page) {
  await page.goto(`${BASE_URL}/events`);
  const cards = page.getByTestId('event-card').filter({
    has: page.getByRole('link', { name: 'Book Now', exact: true }),
  });
  await expect(cards.first()).toBeVisible();

  for (let index = 0; index < await cards.count(); index++) {
    const card = cards.nth(index);
    await card.getByRole('link', { name: 'Book Now', exact: true }).click();
    await expect(page).toHaveURL(/\/events\/\d+/);
    await expect(page.locator('#ticket-count')).toBeVisible();

    const increase = page.getByRole('button', { name: '+' });
    if (await increase.isEnabled()) {
      return;
    }

    await page.goto(`${BASE_URL}/events`);
  }

  throw new Error('Could not find an available event with at least two seats');
}

async function clearBookings(page) {
  await page.goto(`${BASE_URL}/bookings`);
  const emptyState = page.getByText('No bookings yet');
  if (await emptyState.isVisible().catch(() => false)) return;

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /clear all bookings/i }).click();
  await expect(emptyState).toBeVisible();
}

test.describe('Booking Flow', () => {
  test('completes a booking and shows the matching reference and confirmed booking', async ({ page }) => {
    await login(page);
    await clearBookings(page);
    const eventTitle = await openFirstAvailableEvent(page);

    await page.getByLabel('Full Name').fill('Booking Flow Test');
    await page.locator('#customer-email').fill('booking-flow@example.com');
    await page.getByPlaceholder('+91 98765 43210').fill('9876543210');
    await page.locator('#confirm-booking').click();

    await expect(page.getByText('Booking Confirmed!')).toBeVisible();
    await expect(page.getByText('Your tickets are reserved.')).toBeVisible();

    const bookingRef = page.locator('.booking-ref');
    await expect(bookingRef).toHaveText(
      new RegExp(`^${eventTitle[0].toUpperCase()}-[A-Z0-9]{6}$`)
    );
    const bookingReference = (await bookingRef.innerText()).trim();

    await page.getByRole('link', { name: 'View My Bookings' }).click();
    await expect(page).toHaveURL(`${BASE_URL}/bookings`);

    const bookingCard = page.getByTestId('booking-card').filter({ hasText: bookingReference });
    await expect(bookingCard).toBeVisible();
    await expect(bookingCard).toContainText(eventTitle);

    await clearBookings(page);
  });

  test('updates quantity and total price before confirmation', async ({ page }) => {
    await login(page);
    await openEventWithAtLeastTwoSeats(page);

    await expect(page.locator('#ticket-count')).toHaveText('1');
    await expect(page.getByRole('button', { name: '−' })).toBeDisabled();

    const increase = page.getByRole('button', { name: '+' });
    await expect(increase).toBeEnabled();
    await increase.click();
    await expect(page.locator('#ticket-count')).toHaveText('2');

    const priceSummary = page.getByText(/× 2 tickets/i);
    await expect(priceSummary).toBeVisible();
  });

  test('shows validation errors for invalid customer details', async ({ page }) => {
    await login(page);
    await openFirstAvailableEvent(page);

    await page.getByLabel('Full Name').fill('A');
    await page.locator('#customer-email').fill('invalid-email');
    await page.getByPlaceholder('+91 98765 43210').fill('12345');
    await page.locator('#confirm-booking').click();

    await expect(page.getByText('Name must be at least 2 chars')).toBeVisible();
    await expect(page.getByText('Enter a valid email')).toBeVisible();
    await expect(page.getByText('Enter a valid 10-digit phone')).toBeVisible();
  });

  test('does not allow quantity to decrease below one', async ({ page }) => {
    await login(page);
    await openFirstAvailableEvent(page);

    const decrease = page.getByRole('button', { name: '−' });
    await expect(decrease).toBeDisabled();
    await expect(page.locator('#ticket-count')).toHaveText('1');
  });
});
