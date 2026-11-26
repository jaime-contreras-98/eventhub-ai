import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'https://eventhub.rahulshettyacademy.com';
const TEST_EMAIL = process.env.EVENTHUB_TEST_EMAIL ?? '';
const TEST_PASSWORD = process.env.EVENTHUB_TEST_PASSWORD ?? '';
const TEST_ACCOUNT_IS_DISPOSABLE = process.env.EVENTHUB_TEST_ACCOUNT_IS_DISPOSABLE === 'true';

interface CreatedBooking {
  bookingRef: string;
  eventTitle: string;
  quantity: number;
  totalPrice: number;
}

function formatPrice(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

test.skip(
  !TEST_EMAIL || !TEST_PASSWORD || !TEST_ACCOUNT_IS_DISPOSABLE,
  'Set EVENTHUB_TEST_EMAIL, EVENTHUB_TEST_PASSWORD, and EVENTHUB_TEST_ACCOUNT_IS_DISPOSABLE=true for a disposable test account.',
);

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByPlaceholder('you@email.com').fill(TEST_EMAIL);
  await page.getByLabel('Password').fill(TEST_PASSWORD);
  await page.locator('#login-btn').click();
  await expect(page.getByRole('link', { name: /Browse Events/i }).first()).toBeVisible();
}

async function clearBookings(page: Page) {
  await page.goto(`${BASE_URL}/bookings`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /clear all bookings/i }).click();
  await expect(page.getByText('No bookings yet')).toBeVisible();
}

async function createBooking(page: Page, quantity: number = 1): Promise<CreatedBooking> {
  await page.goto(`${BASE_URL}/events`);
  const cards = page.getByTestId('event-card');
  await expect(cards.first()).toBeVisible();

  let eventTitle: string | undefined;
  let selected = false;

  for (let index = 0; index < await cards.count(); index++) {
    const card = cards.nth(index);
    const bookButton = card.getByTestId('book-now-btn');
    if (!await bookButton.isVisible() || await bookButton.getAttribute('aria-disabled') === 'true') continue;

    eventTitle = (await card.locator('h3').textContent())?.trim();
    await bookButton.click();
    await expect(page).toHaveURL(/\/events\/\d+/);

    const incrementButton = page.getByRole('button', { name: '+' });
    if (quantity === 1 || await incrementButton.isEnabled()) {
      for (let ticket = 1; ticket < quantity; ticket++) {
        await incrementButton.click();
      }
      selected = true;
      break;
    }

    await page.goto(`${BASE_URL}/events`);
  }

  if (!selected || !eventTitle) {
    throw new Error(`Could not find an event with ${quantity} available seats`);
  }

  await page.getByLabel('Full Name').fill('Booking Test User');
  await page.locator('#customer-email').fill('booking-test@example.com');
  await page.getByPlaceholder('+91 98765 43210').fill('9876543210');
  const bookingResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/bookings'),
  );
  await page.locator('#confirm-booking').click();
  const bookingResponse = await bookingResponsePromise;
  expect(bookingResponse.ok()).toBe(true);

  const { data: booking } = await bookingResponse.json();
  const bookingQuantity = Number(booking.quantity);
  const eventPrice = Number(booking.event.price);
  const totalPrice = Number(booking.totalPrice);
  expect(bookingQuantity).toBe(quantity);
  expect(totalPrice).toBe(eventPrice * bookingQuantity);

  const reference = page.locator('.booking-ref').first();
  await expect(reference).toBeVisible();
  const bookingRef = (await reference.textContent())?.trim();
  if (!bookingRef) {
    throw new Error('Booking confirmation did not include a reference');
  }
  expect(bookingRef).toMatch(/^[A-Z0-9]-[A-Z0-9]{6}$/);
  return {
    bookingRef,
    eventTitle,
    quantity: bookingQuantity,
    totalPrice,
  };
}

async function openBookingDetails(page: Page, bookingRef: string) {
  await page.goto(`${BASE_URL}/bookings`);
  const card = page.getByTestId('booking-card').filter({ hasText: bookingRef });
  await expect(card).toBeVisible();
  await card.getByRole('link', { name: 'View Details' }).click();
  await expect(page).toHaveURL(/\/bookings\/\d+/);
}

test.describe('Booking management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await clearBookings(page);
  });

  test.afterEach(async ({ page }) => {
    await clearBookings(page);
  });

  test('shows a new booking in the list and its detail view', async ({ page }) => {
    const { bookingRef, eventTitle, quantity, totalPrice } = await createBooking(page, 2);
    expect(bookingRef[0]).toBe(eventTitle[0].toUpperCase());

    await page.goto(`${BASE_URL}/bookings`);
    const card = page.getByTestId('booking-card').filter({ hasText: bookingRef });
    await expect(card).toContainText(eventTitle);
    await expect(card).toContainText('confirmed');
    await expect(card).toContainText(bookingRef);

    await card.getByRole('link', { name: 'View Details' }).click();
    await expect(page.getByRole('heading', { name: eventTitle })).toBeVisible();
    await expect(page.getByText('Customer Details')).toBeVisible();
    await expect(page.getByText('Booking Test User')).toBeVisible();
    const paymentSummary = page.getByRole('heading', { name: 'Payment Summary' }).locator('..');
    await expect(paymentSummary).toContainText(new RegExp(`Tickets\\s*${quantity}`));
    await expect(paymentSummary.getByText(formatPrice(totalPrice), { exact: true })).toBeVisible();
    await expect(page.getByTestId('check-refund-btn')).toBeVisible();
  });

  test('cancels a booking after confirmation and returns to the list', async ({ page }) => {
    const { bookingRef } = await createBooking(page);
    await openBookingDetails(page, bookingRef);

    await page.getByRole('button', { name: 'Cancel Booking' }).click();
    await expect(page.getByText('Cancel this booking?')).toBeVisible();
    await page.getByTestId('confirm-dialog-yes').click();

    await expect(page).toHaveURL(`${BASE_URL}/bookings`);
    await expect(page.getByText('Booking cancelled successfully')).toBeVisible();
    await expect(page.getByText('No bookings yet')).toBeVisible();
  });

  test('keeps a booking when the cancellation dialog is dismissed', async ({ page }) => {
    const { bookingRef } = await createBooking(page);
    await openBookingDetails(page, bookingRef);

    await page.getByRole('button', { name: 'Cancel Booking' }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(page.getByText('Cancel this booking?')).not.toBeVisible();
    await page.goto(`${BASE_URL}/bookings`);
    await expect(page.getByTestId('booking-card').filter({ hasText: bookingRef })).toBeVisible();
  });

  test('clears all bookings and displays the empty state', async ({ page }) => {
    await createBooking(page);
    await clearBookings(page);

    await expect(page.getByText('No bookings yet')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Browse Events' })).toBeVisible();
  });

  test('shows refund eligibility for a single-ticket booking', async ({ page }) => {
    const { bookingRef } = await createBooking(page);
    await openBookingDetails(page, bookingRef);

    await page.getByTestId('check-refund-btn').click();
    await expect(page.getByTestId('refund-spinner')).toBeVisible();
    await expect(page.getByTestId('refund-result')).toContainText('Single-ticket bookings qualify for a full refund', {
      timeout: 6_000,
    });
  });

  test('marks a multi-ticket booking as ineligible for a refund', async ({ page }) => {
    const { bookingRef } = await createBooking(page, 2);
    await openBookingDetails(page, bookingRef);

    await page.getByTestId('check-refund-btn').click();
    await expect(page.getByTestId('refund-spinner')).toBeVisible();
    await expect(page.getByTestId('refund-result')).toContainText('Group bookings (2 tickets) are non-refundable', {
      timeout: 6_000,
    });
  });
});
