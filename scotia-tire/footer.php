<?php
/**
 * The site footer.
 *
 * @package Scotia_Tire
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>

<footer class="st-footer">
	<div class="st-container">

		<?php if ( is_active_sidebar( 'footer-1' ) || is_active_sidebar( 'footer-2' ) || is_active_sidebar( 'footer-3' ) || has_nav_menu( 'footer' ) ) : ?>
			<div class="st-footer__widgets">
				<?php for ( $i = 1; $i <= 3; $i++ ) : ?>
					<?php if ( is_active_sidebar( 'footer-' . $i ) ) : ?>
						<div class="st-footer__col"><?php dynamic_sidebar( 'footer-' . $i ); ?></div>
					<?php endif; ?>
				<?php endfor; ?>

				<?php if ( has_nav_menu( 'footer' ) ) : ?>
					<div class="st-footer__col">
						<h4><?php esc_html_e( 'Quick Links', 'scotia-tire' ); ?></h4>
						<?php
						wp_nav_menu(
							array(
								'theme_location' => 'footer',
								'container'      => false,
								'depth'          => 1,
							)
						);
						?>
					</div>
				<?php endif; ?>
			</div>
		<?php endif; ?>

		<div class="st-footer__bar">
			<div class="st-footer__contact">
				<div class="st-footer__contact-item">
					<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
					<span><?php echo esc_html( scotia_tire_get_option( 'scotia_tire_address' ) ); ?></span>
				</div>
				<div class="st-footer__contact-item">
					<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
					<span><?php echo esc_html( scotia_tire_get_option( 'scotia_tire_hours' ) ); ?></span>
				</div>
				<?php $scotia_phone = scotia_tire_get_option( 'scotia_tire_phone' ); ?>
				<?php if ( $scotia_phone ) : ?>
					<div class="st-footer__contact-item">
						<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/></svg>
						<a href="<?php echo esc_url( 'tel:' . preg_replace( '/[^0-9+]/', '', $scotia_phone ) ); ?>"><?php echo esc_html( $scotia_phone ); ?></a>
					</div>
				<?php endif; ?>
			</div>
			<div class="st-footer__fine">
				<?php echo esc_html( scotia_tire_get_option( 'scotia_tire_disclaim' ) ); ?><br />
				&copy; <?php echo esc_html( gmdate( 'Y' ) ); ?> <?php bloginfo( 'name' ); ?>
			</div>
		</div>

	</div>
</footer>

<?php wp_footer(); ?>
</body>
</html>
