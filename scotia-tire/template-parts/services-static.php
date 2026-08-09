<?php
/**
 * Static services grid — shown on the front page until WooCommerce
 * products exist. Mirrors the original Scotia pricing sheet.
 *
 * @package Scotia_Tire
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$scotia_services = array(
	array(
		'title' => __( 'Trailer Alignment', 'scotia-tire' ),
		'desc'  => __( 'Trailer axle alignment to eliminate dog-tracking and prevent uneven tire wear. Covers tandem and single trailer axle configurations. Digital report included.', 'scotia-tire' ),
		'price' => '95',
		'note'  => __( '+ $110 mobile service call — parts additional if needed', 'scotia-tire' ),
		'icon'  => '<path d="M10 17h4V6H3v11h3"/><path d="M14 10h4.5l2.5 3v4h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
	),
	array(
		'title' => __( 'Single Axle Alignment', 'scotia-tire' ),
		'desc'  => __( 'Precision single-axle alignment for trucks and light commercial vehicles. Corrects camber, caster, and toe to extend tire life and improve handling.', 'scotia-tire' ),
		'price' => '110',
		'note'  => __( '+ $110 mobile service call — parts additional if needed', 'scotia-tire' ),
		'icon'  => '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 3.5v3M12 17.5v3M4.4 7.8l2.6 1.5M17 14.7l2.6 1.5M4.4 16.2l2.6-1.5M17 9.3l2.6-1.5"/>',
	),
	array(
		'title' => __( 'Mobile Service Call', 'scotia-tire' ),
		'desc'  => __( 'Flat dispatch fee for all mobile visits. Covers fuel, travel, and full Hunter 3D equipment mobilization to your fleet yard anywhere in the GTA. Waived for walk-in visits at McAdam Rd.', 'scotia-tire' ),
		'price' => '110',
		'note'  => __( 'Flat fee per mobile dispatch — waived for in-shop walk-ins', 'scotia-tire' ),
		'icon'  => '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
	),
	array(
		'title' => __( '24/7 Emergency Roadside', 'scotia-tire' ),
		'desc'  => __( 'Flat tire, breakdown, or urgent alignment issue? Our Tire Service Network deploys a technician to your location within 90 minutes, anywhere in the GTA — day or night.', 'scotia-tire' ),
		'price' => '110',
		'note'  => __( 'Service call + labour — available 24/7 always', 'scotia-tire' ),
		'icon'  => '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
	),
);

$scotia_svg_allowed = array(
	'svg'    => array(
		'viewbox'     => true,
		'aria-hidden' => true,
		'focusable'   => true,
	),
	'path'   => array( 'd' => true ),
	'circle' => array(
		'cx' => true,
		'cy' => true,
		'r'  => true,
	),
);
?>

<div class="st-grid">
	<?php foreach ( $scotia_services as $scotia_service ) : ?>
		<div class="st-card">
			<div class="st-card__icon">
				<?php echo wp_kses( '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' . $scotia_service['icon'] . '</svg>', $scotia_svg_allowed ); ?>
			</div>
			<h3><?php echo esc_html( $scotia_service['title'] ); ?></h3>
			<p><?php echo esc_html( $scotia_service['desc'] ); ?></p>
			<div class="st-card__foot">
				<span class="st-price"><span class="cur">$</span><span class="num"><?php echo esc_html( $scotia_service['price'] ); ?></span></span>
				<span class="st-card__note"><?php echo esc_html( $scotia_service['note'] ); ?></span>
			</div>
		</div>
	<?php endforeach; ?>
</div>
