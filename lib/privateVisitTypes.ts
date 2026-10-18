export type PrivateInvoice = {
  id: string;
  booking_id: string;
  invoice_number: string;
  issued_at: string;
  status: string;
  completed_at: string;
  customer_name: string;
  service_name: string;
  address: string | null;
  property_size_sqm: number | null;
  duration_minutes: number;
  gross_amount: number | null;
  platform_fee: number | null;
  payout_amount: number;
  payout_schedule: string;
  payout_due_on: string;
  providers: {
    display_name: string | null;
    profile?: { full_name: string | null; email: string | null } | null;
    profiles?: unknown;
  } | null;
};
export type PrivateBookingTiming = {
  scheduled_at: string;
  check_ins: { arrived_at: string | null; left_at: string | null }[];
};
