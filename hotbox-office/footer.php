<?php
/**
 * The site footer: logo, links, widgets, disclaimer.
 *
 * @package Hotbox_Office
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>

<footer class="hb-footer">
	<div class="hb-wrap">

		<div class="hb-footer__grid">
			<a class="hb-logo" href="<?php echo esc_url( home_url( '/' ) ); ?>">
				<?php hotbox_office_logo_mark(); ?>
				<span class="hb-logo__word">
					<b><?php bloginfo( 'name' ); ?></b>
					<?php $hotbox_sub = hotbox_office_get_option( 'hotbox_tagline' ); ?>
					<?php if ( $hotbox_sub ) : ?>
						<small><?php echo esc_html( $hotbox_sub ); ?></small>
					<?php endif; ?>
				</span>
			</a>

			<div class="hb-footer__links">
				<?php
				if ( has_nav_menu( 'footer' ) ) {
					wp_nav_menu(
						array(
							'theme_location' => 'footer',
							'container'      => false,
							'depth'          => 1,
						)
					);
				}
				?>
				<?php $hotbox_email = hotbox_office_get_option( 'hotbox_email' ); ?>
				<?php if ( $hotbox_email ) : ?>
					<a href="<?php echo esc_url( 'mailto:' . $hotbox_email ); ?>"><?php esc_html_e( 'Contact', 'hotbox-office' ); ?></a>
				<?php endif; ?>
			</div>
		</div>

		<?php if ( is_active_sidebar( 'footer-1' ) || is_active_sidebar( 'footer-2' ) || is_active_sidebar( 'footer-3' ) ) : ?>
			<div class="hb-footer__widgets">
				<?php for ( $i = 1; $i <= 3; $i++ ) : ?>
					<?php if ( is_active_sidebar( 'footer-' . $i ) ) : ?>
						<div class="hb-footer__col"><?php dynamic_sidebar( 'footer-' . $i ); ?></div>
					<?php endif; ?>
				<?php endfor; ?>
			</div>
		<?php endif; ?>

		<p class="hb-disclaimer">
			&copy; <?php echo esc_html( gmdate( 'Y' ) ); ?> <?php bloginfo( 'name' ); ?>.
			<?php echo esc_html( hotbox_office_get_option( 'hotbox_disclaimer' ) ); ?>
		</p>

	</div>
</footer>

<?php wp_footer(); ?>
</body>
</html>
