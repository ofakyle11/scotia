<?php
/**
 * Front page template.
 *
 * Recreates the Scotia pricing-sheet layout as a live storefront:
 * hero offer, service/product grid, feature strip.
 *
 * @package Scotia_Tire
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

get_header();

$scotia_shop_url = scotia_tire_is_woocommerce_active() ? get_permalink( wc_get_page_id( 'shop' ) ) : home_url( '/' );
?>

<main id="primary" class="st-main">

	<!-- Hero: flagship service -->
	<section class="st-hero">
		<div class="st-container">
			<div class="st-hero__card">
				<div class="st-badge"><?php esc_html_e( 'Best Value', 'scotia-tire' ); ?></div>
				<div class="st-hero__left">
					<div class="st-hero__icon">
						<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 17h4V6H3v11h3"/><path d="M14 10h4.5l2.5 3v4h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>
					</div>
					<div>
						<h1><?php esc_html_e( 'Full 3-Axle Alignment', 'scotia-tire' ); ?></h1>
						<p><?php esc_html_e( 'Complete computerized multi-axle alignment with Hunter 3D measurement, full adjustment, and a digital before/after report on completion. Parts additional if required.', 'scotia-tire' ); ?></p>
						<div class="st-hero__cta">
							<a class="st-btn" href="<?php echo esc_url( $scotia_shop_url ); ?>"><?php esc_html_e( 'Book a Service', 'scotia-tire' ); ?></a>
							<a class="st-btn st-btn--ghost" href="#st-services"><?php esc_html_e( 'View Pricing', 'scotia-tire' ); ?></a>
						</div>
					</div>
				</div>
				<div class="st-hero__right">
					<div class="st-price"><span class="cur">$</span><span class="num">270</span></div>
					<div class="st-hero__note"><?php esc_html_e( '+ $110 mobile service call · Plus any required parts', 'scotia-tire' ); ?></div>
				</div>
			</div>
		</div>
	</section>

	<!-- Services / products -->
	<section id="st-services" class="st-section">
		<div class="st-container">
			<div class="st-section__head">
				<h2><?php esc_html_e( 'Services &', 'scotia-tire' ); ?> <span class="accent"><?php esc_html_e( 'Pricing', 'scotia-tire' ); ?></span></h2>
				<?php if ( scotia_tire_is_woocommerce_active() ) : ?>
					<a class="st-more" href="<?php echo esc_url( $scotia_shop_url ); ?>"><?php esc_html_e( 'View all services →', 'scotia-tire' ); ?></a>
				<?php endif; ?>
			</div>

			<?php
			$scotia_products = array();
			if ( scotia_tire_is_woocommerce_active() ) {
				$scotia_products = wc_get_products(
					array(
						'status'     => 'publish',
						'limit'      => 4,
						'featured'   => true,
						'visibility' => 'catalog',
					)
				);
				if ( empty( $scotia_products ) ) {
					$scotia_products = wc_get_products(
						array(
							'status'     => 'publish',
							'limit'      => 4,
							'orderby'    => 'date',
							'order'      => 'DESC',
							'visibility' => 'catalog',
						)
					);
				}
			}
			?>

			<?php if ( ! empty( $scotia_products ) ) : ?>
				<div class="st-grid">
					<?php foreach ( $scotia_products as $scotia_product ) : ?>
						<div class="st-card">
							<?php if ( $scotia_product->get_image_id() ) : ?>
								<a class="st-card__thumb" href="<?php echo esc_url( $scotia_product->get_permalink() ); ?>">
									<?php echo wp_get_attachment_image( $scotia_product->get_image_id(), 'woocommerce_thumbnail' ); ?>
								</a>
							<?php else : ?>
								<div class="st-card__icon">
									<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 3.5v3M12 17.5v3M4.4 7.8l2.6 1.5M17 14.7l2.6 1.5M4.4 16.2l2.6-1.5M17 9.3l2.6-1.5"/></svg>
								</div>
							<?php endif; ?>
							<h3><a href="<?php echo esc_url( $scotia_product->get_permalink() ); ?>"><?php echo esc_html( $scotia_product->get_name() ); ?></a></h3>
							<p><?php echo esc_html( wp_trim_words( wp_strip_all_tags( $scotia_product->get_short_description() ? $scotia_product->get_short_description() : $scotia_product->get_description() ), 24 ) ); ?></p>
							<div class="st-card__foot">
								<span class="st-price"><?php echo wp_kses_post( $scotia_product->get_price_html() ); ?></span>
								<a class="st-btn st-btn--ghost" href="<?php echo esc_url( $scotia_product->get_permalink() ); ?>"><?php esc_html_e( 'Details', 'scotia-tire' ); ?></a>
							</div>
						</div>
					<?php endforeach; ?>
				</div>
			<?php else : ?>
				<?php get_template_part( 'template-parts/services', 'static' ); ?>
			<?php endif; ?>
		</div>
	</section>

	<!-- Feature strip -->
	<section class="st-section" style="padding-top: 0;">
		<div class="st-container">
			<div class="st-features">
				<div class="st-feature">
					<div class="st-feature__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg></div>
					<div>
						<h4><?php esc_html_e( 'Hunter 3D Equipment', 'scotia-tire' ); ?></h4>
						<p><?php esc_html_e( 'Computerized precision alignment with full digital before/after reporting.', 'scotia-tire' ); ?></p>
					</div>
				</div>
				<div class="st-feature">
					<div class="st-feature__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"/></svg></div>
					<div>
						<h4><?php esc_html_e( 'Certified Technicians', 'scotia-tire' ); ?></h4>
						<p><?php esc_html_e( 'Experienced with fleet, trailer, and heavy commercial vehicles.', 'scotia-tire' ); ?></p>
					</div>
				</div>
				<div class="st-feature">
					<div class="st-feature__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></div>
					<div>
						<h4><?php esc_html_e( 'GTA-Wide Coverage', 'scotia-tire' ); ?></h4>
						<p><?php esc_html_e( 'Mobile dispatch to your yard or roadside, anywhere in the Greater Toronto Area.', 'scotia-tire' ); ?></p>
					</div>
				</div>
				<div class="st-feature">
					<div class="st-feature__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg></div>
					<div>
						<h4><?php esc_html_e( '24/7 Availability', 'scotia-tire' ); ?></h4>
						<p><?php esc_html_e( 'Emergency roadside and urgent alignment support, day or night.', 'scotia-tire' ); ?></p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<?php
	// Optional editable page content below the built-in sections.
	while ( have_posts() ) :
		the_post();
		$scotia_content = get_the_content();
		if ( trim( $scotia_content ) ) :
			?>
			<section class="st-section">
				<div class="st-container st-entry st-post__content">
					<?php the_content(); ?>
				</div>
			</section>
			<?php
		endif;
	endwhile;
	?>

</main>

<?php
get_footer();
