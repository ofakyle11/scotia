<?php
/**
 * Search form.
 *
 * @package Scotia_Tire
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$scotia_search_id = wp_unique_id( 'st-search-' );
?>
<form role="search" method="get" class="st-search-form" action="<?php echo esc_url( home_url( '/' ) ); ?>">
	<label class="screen-reader-text" for="<?php echo esc_attr( $scotia_search_id ); ?>"><?php esc_html_e( 'Search for:', 'scotia-tire' ); ?></label>
	<input type="search" id="<?php echo esc_attr( $scotia_search_id ); ?>" name="s" value="<?php echo get_search_query(); ?>" placeholder="<?php esc_attr_e( 'Search…', 'scotia-tire' ); ?>" />
	<button type="submit" class="st-btn"><?php esc_html_e( 'Search', 'scotia-tire' ); ?></button>
</form>
