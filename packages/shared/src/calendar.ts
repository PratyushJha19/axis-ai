export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
  all_day: boolean;
  busy: boolean;
}
export interface CalendarView {
  configured: boolean;
  status: string;
  last_sync: string | null;
  range_start: string | null;
  range_end: string | null;
  warning: string | null;
  events: CalendarEvent[];
  error_code: string | null;
}
