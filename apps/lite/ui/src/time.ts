/** @public */
export const formatRelativeTimeWith =
	(rtf: Intl.RelativeTimeFormat) =>
	(timestamp: number, now = Date.now()): string => {
		const seconds = Math.round((timestamp - now) / 1000);
		const absSeconds = Math.abs(seconds);

		if (absSeconds < 60) return rtf.format(seconds, "seconds");
		if (absSeconds < 60 * 60) return rtf.format(Math.round(seconds / 60), "minutes");
		if (absSeconds < 60 * 60 * 24) return rtf.format(Math.round(seconds / 60 / 60), "hours");
		if (absSeconds < 60 * 60 * 24 * 30)
			return rtf.format(Math.round(seconds / 60 / 60 / 24), "days");
		if (absSeconds < 60 * 60 * 24 * 365)
			return rtf.format(Math.round(seconds / 60 / 60 / 24 / 30), "months");
		return rtf.format(Math.round(seconds / 60 / 60 / 24 / 365), "years");
	};

const stdRelativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
	numeric: "auto",
	style: "long",
});

export const formatRelativeTime: (timestamp: number, now?: number) => string =
	formatRelativeTimeWith(stdRelativeTimeFormatter);
