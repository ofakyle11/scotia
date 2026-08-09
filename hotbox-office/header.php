<?php
/**
 * The site header: announcement bar, logo, nav, cart pill.
 *
 * @package Hotbox_Office
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="theme-color" content="#0C0D0A" />
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<a class="screen-reader-text" href="#primary"><?php esc_html_e( 'Skip to content', 'hotbox-office' ); ?></a>

<?php $hotbox_announce = hotbox_office_get_option( 'hotbox_announce' ); ?>
<?php if ( $hotbox_announce ) : ?>
	<div class="hb-announce"><?php echo esc_html( $hotbox_announce ); ?></div>
<?php endif; ?>

<header class="hb-header">
	<div class="hb-header__inner">

		<a class="hb-logo" href="<?php echo esc_url( home_url( '/' ) ); ?>" rel="home">
			<?php if ( has_custom_logo() ) : ?>
				<span class="hb-logo__img"><?php the_custom_logo(); ?></span>
			<?php else : ?>
				<?php hotbox_office_logo_mark(); ?>
				<span class="hb-logo__word">
					<b><?php bloginfo( 'name' ); ?></b>
					<?php $hotbox_sub = hotbox_office_get_option( 'hotbox_tagline' ); ?>
					<?php if ( $hotbox_sub ) : ?>
						<small><?php echo esc_html( $hotbox_sub ); ?></small>
					<?php endif; ?>
				</span>
			<?php endif; ?>
		</a>

		<nav id="hb-nav" class="hb-nav" aria-label="<?php esc_attr_e( 'Main', 'hotbox-office' ); ?>">
			<?php
			wp_nav_menu(
				array(
					'theme_location' => 'primary',
					'container'      => false,
					'fallback_cb'    => 'hotbox_office_fallback_menu',
				)
			);
			?>
		</nav>

		<?php hotbox_office_header_cart(); ?>

		<button class="hb-btn hb-btn--ghost hb-menu-toggle" aria-controls="hb-nav" aria-expanded="false">
			<span class="screen-reader-text"><?php esc_html_e( 'Toggle menu', 'hotbox-office' ); ?></span>
			<span aria-hidden="true">&#9776;</span>
		</button>

	</div>
</header>
