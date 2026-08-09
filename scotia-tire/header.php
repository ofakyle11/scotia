<?php
/**
 * The site header.
 *
 * @package Scotia_Tire
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
<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<a class="screen-reader-text" href="#primary"><?php esc_html_e( 'Skip to content', 'scotia-tire' ); ?></a>

<header class="st-header">
	<div class="st-container st-header__inner">

		<a class="st-brand" href="<?php echo esc_url( home_url( '/' ) ); ?>" rel="home">
			<?php if ( has_custom_logo() ) : ?>
				<span class="st-brand__logo"><?php the_custom_logo(); ?></span>
			<?php else : ?>
				<span class="st-brand__mark"><?php scotia_tire_brand_mark_svg(); ?></span>
			<?php endif; ?>
			<span class="st-brand__text">
				<span class="st-brand__name">
					<?php
					// Highlight the word "Tire" in red when present, matching the brand lockup.
					$site_name = get_bloginfo( 'name' );
					$pattern   = '/\b(tire)\b/i';
					if ( preg_match( $pattern, $site_name ) ) {
						echo wp_kses(
							preg_replace( $pattern, '<span>$1</span>', esc_html( $site_name ) ),
							array( 'span' => array() )
						);
					} else {
						echo esc_html( $site_name );
					}
					?>
				</span>
				<span class="st-brand__sub"><?php echo esc_html( scotia_tire_get_option( 'scotia_tire_tagline' ) ); ?></span>
			</span>
		</a>

		<nav id="st-nav" class="st-nav" aria-label="<?php esc_attr_e( 'Primary navigation', 'scotia-tire' ); ?>">
			<?php
			wp_nav_menu(
				array(
					'theme_location' => 'primary',
					'container'      => false,
					'fallback_cb'    => 'scotia_tire_fallback_menu',
				)
			);
			?>
		</nav>

		<div class="st-header__actions">
			<?php scotia_tire_header_cart(); ?>
			<button class="st-menu-toggle" aria-controls="st-nav" aria-expanded="false">
				<span class="screen-reader-text"><?php esc_html_e( 'Toggle menu', 'scotia-tire' ); ?></span>
				<span aria-hidden="true">&#9776;</span>
			</button>
		</div>

	</div>
</header>
