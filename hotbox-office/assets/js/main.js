/**
 * Hotbox Office — mobile navigation toggle.
 */
( function () {
	'use strict';

	document.addEventListener( 'DOMContentLoaded', function () {
		var toggle = document.querySelector( '.hb-menu-toggle' );
		var nav = document.getElementById( 'hb-nav' );

		if ( ! toggle || ! nav ) {
			return;
		}

		toggle.addEventListener( 'click', function () {
			var open = nav.classList.toggle( 'is-open' );
			toggle.setAttribute( 'aria-expanded', open ? 'true' : 'false' );
		} );

		document.addEventListener( 'keydown', function ( e ) {
			if ( 'Escape' === e.key && nav.classList.contains( 'is-open' ) ) {
				nav.classList.remove( 'is-open' );
				toggle.setAttribute( 'aria-expanded', 'false' );
				toggle.focus();
			}
		} );
	} );
} )();
