package site.amoeba.shoptalk

/**
 * "Where in the app the user is": shown as a chip above the input and sent with
 * the next message so the agent (and the console) know e.g. the booking in question.
 *
 * @param screen Stable screen code, e.g. `bookings`.
 * @param ref Record reference, e.g. `#G2J-8841`.
 * @param label Human text for the chip, e.g. `Booking #G2J-8841`.
 * @param prefill Draft text put into an empty input box (the user can still edit it).
 */
data class ShopTalkContext(
    val screen: String,
    val ref: String? = null,
    val label: String? = null,
    val prefill: String? = null,
)
